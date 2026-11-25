"use server";

import { refresh } from "next/cache";
import { Prisma } from "@/generated/prisma/client";
import { requireSchoolAdmin } from "@/lib/auth/dal";
import { schoolDb, type Tx } from "@/lib/db";
import { insertAudit } from "@/lib/audit";
import { getClientIp } from "@/lib/auth/session";
import type { FormState } from "@/lib/form";
import { ImportFileError, checkRows, readTable, type ParsedRow } from "@/lib/import";
import type { ImportReport, ReportRow } from "@/lib/import-types";
import { newQrToken } from "@/lib/students";
import { NEW_STUDENT_BYTES, measureUsage, saveUsage, storageStatus } from "@/lib/storage";

const PREVIEW_ROWS = 300;

type Plan = {
  report: Omit<ImportReport, "stage" | "fingerprint" | "fileName">;
  creates: ParsedRow[];
  updates: { id: number; row: ParsedRow }[];
};

/** Compares checked rows with the database and decides what happens to each. */
async function planImport(tx: Tx, schoolId: number, rows: ParsedRow[], mode: "skip" | "update", createClasses: boolean): Promise<Plan> {
  const valid = rows.filter((r) => r.errors.length === 0);
  const existing = await tx.student.findMany({
    where: { studentCode: { in: valid.map((r) => r.studentCode), mode: "insensitive" } },
    select: { id: true, studentCode: true, fullName: true, classGroup: { select: { name: true } } },
  });
  const byCode = new Map(existing.map((s) => [s.studentCode.toLowerCase(), s]));
  const classes = await tx.classGroup.findMany({ select: { name: true } });
  const known = new Set(classes.map((c) => c.name.toLowerCase()));
  const newClasses = new Map<string, string>();

  const out: ReportRow[] = [];
  const creates: ParsedRow[] = [];
  const updates: { id: number; row: ParsedRow }[] = [];
  for (const r of rows) {
    const messages = [...r.errors];
    let outcome: ReportRow["outcome"] = "error";
    if (messages.length === 0 && r.className && !known.has(r.className.toLowerCase())) {
      if (createClasses) newClasses.set(r.className.toLowerCase(), r.className);
      else messages.push(`Class “${r.className}” does not exist. Add it on the Classes page or tick “create missing classes”.`);
    }
    if (messages.length === 0) {
      const match = byCode.get(r.studentCode.toLowerCase());
      if (!match) {
        outcome = "create";
        creates.push(r);
      } else if (mode === "update") {
        outcome = "update";
        updates.push({ id: match.id, row: r });
        messages.push(`Updates ${match.fullName}${match.classGroup ? ` (${match.classGroup.name})` : ""}.`);
      } else {
        outcome = "skip";
        messages.push(`Already exists (${match.fullName}) — skipped.`);
      }
    }
    out.push({ line: r.line, studentCode: r.studentCode, fullName: r.fullName, className: r.className, outcome, messages });
  }

  const status = await storageStatus(tx, schoolId);
  const neededBytes = creates.length * NEW_STUDENT_BYTES;
  const order = { error: 0, skip: 1, update: 2, create: 3 } as const;
  return {
    creates,
    updates,
    report: {
      total: rows.length,
      create: creates.length,
      update: updates.length,
      skip: out.filter((r) => r.outcome === "skip").length,
      errors: out.filter((r) => r.outcome === "error").length,
      newClasses: [...newClasses.values()],
      rows: [...out].sort((a, b) => order[a.outcome] - order[b.outcome] || a.line - b.line).slice(0, PREVIEW_ROWS),
      storage: {
        noPlan: status.quota.limit === null,
        neededBytes,
        remainingBytes: status.remaining,
        enough: creates.length === 0 || (status.quota.limit !== null && neededBytes <= status.remaining),
      },
    },
  };
}

class ImportAbort extends Error {}

/**
 * One action for both steps:
 *   intent=preview  -> check the file, change nothing
 *   intent=commit   -> check again (never trust the earlier preview) and save
 */
export async function importStudents(_prev: FormState, formData: FormData): Promise<FormState> {
  const user = await requireSchoolAdmin();
  const file = formData.get("file");
  const intent = formData.get("intent") === "commit" ? "commit" : "preview";
  const mode = formData.get("mode") === "update" ? "update" : "skip";
  const createClasses = formData.get("createClasses") === "on" || formData.get("createClasses") === "1";
  if (!(file instanceof File) || file.size === 0) return { error: "Choose an Excel or CSV file first." };
  const fingerprint = `${file.name}|${file.size}|${String(formData.get("lastModified") ?? "")}`;

  let rows: ParsedRow[];
  try {
    rows = checkRows(await readTable(file)).rows;
  } catch (error) {
    if (error instanceof ImportFileError) return { error: error.message };
    console.error("import read failed", error);
    return { error: "This file could not be read. Use the template and save as .xlsx or .csv." };
  }

  if (intent === "preview") {
    const plan = await schoolDb(user, (tx) => planImport(tx, user.school.id, rows, mode, createClasses), { timeout: 30_000 });
    const data: ImportReport = { stage: "preview", fingerprint, fileName: file.name, ...plan.report };
    return { ok: true, data };
  }

  const ip = await getClientIp();
  let report: Plan["report"];
  try {
    report = await schoolDb(
      user,
      async (tx) => {
        // Serialize imports per school so two at once can't both pass the checks.
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('student-import'), ${user.school.id})`;
        const plan = await planImport(tx, user.school.id, rows, mode, createClasses);
        if (plan.creates.length + plan.updates.length === 0) throw new ImportAbort("Nothing to import: every row is skipped or has an error.");
        if (plan.report.storage.noPlan && plan.creates.length > 0) {
          throw new ImportAbort("Your school has no active subscription, so new students can’t be added. Please contact the platform administrator.");
        }
        if (!plan.report.storage.enough) {
          const fits = Math.floor(plan.report.storage.remainingBytes / NEW_STUDENT_BYTES);
          throw new ImportAbort(
            `Not enough storage for ${plan.creates.length.toLocaleString("en-US")} new students (room for about ${fits.toLocaleString("en-US")}). Nothing was imported. Import a smaller file or ask for more storage.`,
          );
        }

        const classIds = new Map<string, number>();
        for (const name of plan.report.newClasses) {
          await tx.classGroup.create({ data: { schoolId: user.school.id, name } });
        }
        for (const c of await tx.classGroup.findMany({ select: { id: true, name: true } })) classIds.set(c.name.toLowerCase(), c.id);
        const classOf = (r: ParsedRow) => (r.className ? (classIds.get(r.className.toLowerCase()) ?? null) : null);

        for (let i = 0; i < plan.creates.length; i += 500) {
          await tx.student.createMany({
            data: plan.creates.slice(i, i + 500).map((r) => ({
              schoolId: user.school.id,
              studentCode: r.studentCode,
              fullName: r.fullName,
              classGroupId: classOf(r),
              qrToken: newQrToken(),
            })),
          });
        }
        for (const u of plan.updates) {
          await tx.student.update({
            where: { id: u.id },
            // An empty Class cell keeps the student's current class.
            data: { fullName: u.row.fullName, ...(u.row.className && { classGroupId: classOf(u.row) }) },
          });
        }
        await insertAudit(tx, {
          action: "student.import",
          schoolId: user.school.id,
          actorUserId: user.id,
          entityType: "import",
          details: {
            file: file.name.slice(0, 100),
            created: plan.creates.length,
            updated: plan.updates.length,
            skipped: plan.report.skip,
            errors: plan.report.errors,
            newClasses: plan.report.newClasses.length,
          },
          ipAddress: ip,
        });
        return plan.report;
      },
      { timeout: 120_000 },
    );
  } catch (error) {
    if (error instanceof ImportAbort) return { error: error.message };
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return { error: "Some students were added by someone else at the same time. Nothing was imported — please check the file again." };
    }
    console.error("import commit failed", error);
    return { error: "Something went wrong. Nothing was imported (all-or-nothing). Please try again." };
  }

  const usage = await schoolDb(user, (tx) => measureUsage(tx, user.school.id));
  await saveUsage(user.school.id, usage.total);
  refresh();
  const data: ImportReport = { stage: "done", fingerprint, fileName: file.name, ...report };
  return { ok: true, data };
}
