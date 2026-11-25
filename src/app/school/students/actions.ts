"use server";

import { redirect } from "next/navigation";
import { refresh } from "next/cache";
import { Prisma } from "@/generated/prisma/client";
import { requireSchoolAdmin, type SchoolAdminContext } from "@/lib/auth/dal";
import { schoolDb, type Tx } from "@/lib/db";
import { insertAudit } from "@/lib/audit";
import { getClientIp } from "@/lib/auth/session";
import { invalid, readFields, toId, type FormState } from "@/lib/form";
import { studentSchema } from "@/lib/validation/student";
import { MAX_PHOTO_BYTES, newQrToken, sniffImageType } from "@/lib/students";
import { NEW_STUDENT_BYTES, QuotaError, assertRoom, measureUsage, saveUsage } from "@/lib/storage";

/*
 * Student management for School Admins. The school always comes from the
 * verified session (user.school.id); Row-Level Security additionally makes
 * every other school's rows invisible and unwritable.
 */

const FIELDS = ["studentCode", "fullName", "classGroupId"] as const;

/** Friendly checks shared by create and update. Returns an error state or null. */
async function checkStudentInput(
  tx: Tx,
  input: { studentCode: string; classGroupId: number | null },
  exceptId?: number,
): Promise<FormState | null> {
  const dup = await tx.student.findFirst({
    where: { studentCode: { equals: input.studentCode, mode: "insensitive" }, ...(exceptId && { id: { not: exceptId } }) },
    select: { fullName: true },
  });
  if (dup) {
    const msg = `This student ID is already used by ${dup.fullName}.`;
    return { error: msg, fieldErrors: { studentCode: [msg] } };
  }
  if (input.classGroupId !== null && !(await tx.classGroup.findUnique({ where: { id: input.classGroupId }, select: { id: true } }))) {
    return { error: "Choose a class from the list.", fieldErrors: { classGroupId: ["Choose a class from the list."] } };
  }
  return null;
}

async function remeasure(user: SchoolAdminContext) {
  const usage = await schoolDb(user, (tx) => measureUsage(tx, user.school.id));
  await saveUsage(user.school.id, usage.total);
}

export async function createStudent(_prev: FormState, formData: FormData): Promise<FormState> {
  const user = await requireSchoolAdmin();
  const values = readFields(formData, FIELDS);
  const parsed = studentSchema.safeParse(values);
  if (!parsed.success) return invalid(parsed.error, values);
  const input = parsed.data;
  const ip = await getClientIp();

  let id: number;
  try {
    const result = await schoolDb(user, async (tx) => {
      const problem = await checkStudentInput(tx, input);
      if (problem) return problem;
      await assertRoom(tx, user.school.id, NEW_STUDENT_BYTES);
      const s = await tx.student.create({
        data: { schoolId: user.school.id, ...input, qrToken: newQrToken() },
        select: { id: true },
      });
      await insertAudit(tx, {
        action: "student.create",
        schoolId: user.school.id,
        actorUserId: user.id,
        entityType: "student",
        entityId: s.id,
        details: { studentCode: input.studentCode },
        ipAddress: ip,
      });
      return s.id;
    });
    if (typeof result !== "number") return { ...result, values };
    id = result;
  } catch (error) {
    if (error instanceof QuotaError) return { error: error.message, values };
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return { error: "This student ID is already in use.", fieldErrors: { studentCode: ["Already in use."] }, values };
    }
    console.error("createStudent failed", error);
    return { error: "Something went wrong. Nothing was saved.", values };
  }
  await remeasure(user);
  redirect(formData.get("addAnother") === "1" ? `/school/students/new?added=${id}` : `/school/students/${id}?created=1`);
}

export async function updateStudent(_prev: FormState, formData: FormData): Promise<FormState> {
  const user = await requireSchoolAdmin();
  const studentId = toId(formData.get("studentId"));
  if (!studentId) return { error: "Invalid request." };
  const values = readFields(formData, FIELDS);
  const parsed = studentSchema.safeParse(values);
  if (!parsed.success) return invalid(parsed.error, values);
  const input = parsed.data;
  const ip = await getClientIp();

  try {
    const result = await schoolDb(user, async (tx) => {
      const before = await tx.student.findUnique({ where: { id: studentId } });
      if (!before) return { error: "Student not found." } as FormState;
      const problem = await checkStudentInput(tx, input, studentId);
      if (problem) return problem;
      await tx.student.update({ where: { id: studentId }, data: input });
      const changes: Record<string, [unknown, unknown]> = {};
      for (const k of FIELDS) if (before[k] !== input[k]) changes[k] = [before[k], input[k]];
      if (Object.keys(changes).length) {
        await insertAudit(tx, {
          action: "student.update",
          schoolId: user.school.id,
          actorUserId: user.id,
          entityType: "student",
          entityId: studentId,
          details: changes as Prisma.InputJsonValue,
          ipAddress: ip,
        });
      }
      return null;
    });
    if (result) return { ...result, values };
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return { error: "This student ID is already in use.", values };
    }
    console.error("updateStudent failed", error);
    return { error: "Something went wrong. Nothing was saved.", values };
  }
  refresh();
  return { ok: true, message: "Changes saved." };
}

/** Deactivate (keeps all history, stops QR scans) or reactivate a student. */
export async function setStudentStatus(_prev: FormState, formData: FormData): Promise<FormState> {
  const user = await requireSchoolAdmin();
  const studentId = toId(formData.get("studentId"));
  const status = formData.get("status") === "ACTIVE" ? "ACTIVE" : "INACTIVE";
  if (!studentId) return { error: "Invalid request." };
  const ok = await schoolDb(user, async (tx) => {
    const n = await tx.student.updateMany({ where: { id: studentId }, data: { status } });
    if (n.count === 0) return false;
    await insertAudit(tx, {
      action: status === "ACTIVE" ? "student.activate" : "student.deactivate",
      schoolId: user.school.id,
      actorUserId: user.id,
      entityType: "student",
      entityId: studentId,
    });
    return true;
  });
  if (!ok) return { error: "Student not found." };
  refresh();
  return { ok: true, message: status === "ACTIVE" ? "Student is active again." : "Student deactivated. Their card no longer works." };
}

/**
 * Permanently deletes a student. Only allowed when they have NO attendance
 * records (e.g. added by mistake); otherwise deactivate them to keep history.
 */
export async function deleteStudent(_prev: FormState, formData: FormData): Promise<FormState> {
  const user = await requireSchoolAdmin();
  const studentId = toId(formData.get("studentId"));
  if (!studentId) return { error: "Invalid request." };
  const ip = await getClientIp();
  const result = await schoolDb(user, async (tx) => {
    const s = await tx.student.findUnique({
      where: { id: studentId },
      select: { studentCode: true, fullName: true, _count: { select: { attendance: true } } },
    });
    if (!s) return "missing" as const;
    if (s._count.attendance > 0) return "history" as const;
    await tx.studentPhoto.deleteMany({ where: { studentId } });
    await tx.student.delete({ where: { id: studentId } });
    await insertAudit(tx, {
      action: "student.delete",
      schoolId: user.school.id,
      actorUserId: user.id,
      entityType: "student",
      entityId: studentId,
      details: { studentCode: s.studentCode, fullName: s.fullName },
      ipAddress: ip,
    });
    return "ok" as const;
  });
  if (result === "missing") return { error: "Student not found." };
  if (result === "history") {
    return { error: "This student has attendance records, so they can't be deleted. Deactivate them instead to keep their history." };
  }
  await remeasure(user);
  redirect("/school/students?deleted=1");
}

/** Issues a new QR code. The old card stops working immediately (e.g. lost card). */
export async function regenerateQr(_prev: FormState, formData: FormData): Promise<FormState> {
  const user = await requireSchoolAdmin();
  const studentId = toId(formData.get("studentId"));
  if (!studentId) return { error: "Invalid request." };
  const ok = await schoolDb(user, async (tx) => {
    const n = await tx.student.updateMany({ where: { id: studentId }, data: { qrToken: newQrToken(), qrIssuedAt: new Date() } });
    if (n.count === 0) return false;
    await insertAudit(tx, {
      action: "student.regenerate_qr",
      schoolId: user.school.id,
      actorUserId: user.id,
      entityType: "student",
      entityId: studentId,
    });
    return true;
  });
  if (!ok) return { error: "Student not found." };
  refresh();
  return { ok: true, message: "New QR code issued. Print a new card — the old one no longer works." };
}

// ---------------------------------------------------------------------
//  Photos (the browser shrinks the image first; we re-check everything)
// ---------------------------------------------------------------------

export async function uploadPhoto(_prev: FormState, formData: FormData): Promise<FormState> {
  const user = await requireSchoolAdmin();
  const studentId = toId(formData.get("studentId"));
  const file = formData.get("photo");
  if (!studentId) return { error: "Invalid request." };
  if (!(file instanceof File) || file.size === 0) return { error: "Choose a photo first." };
  if (file.size > MAX_PHOTO_BYTES) return { error: "This photo is too large (max 300 KB after resizing)." };
  const data = new Uint8Array(await file.arrayBuffer());
  const contentType = sniffImageType(data);
  if (!contentType) return { error: "Use a JPG, PNG or WebP image." };

  try {
    const ok = await schoolDb(user, async (tx) => {
      const s = await tx.student.findUnique({ where: { id: studentId }, select: { photoBytes: true } });
      if (!s) return false;
      // Only the size difference needs room (replacing a photo frees the old one).
      await assertRoom(tx, user.school.id, data.length - (s.photoBytes ?? 0));
      await tx.studentPhoto.upsert({
        where: { studentId },
        create: { studentId, schoolId: user.school.id, contentType, bytes: data.length, data },
        update: { contentType, bytes: data.length, data, createdAt: new Date() },
      });
      await tx.student.update({
        where: { id: studentId },
        data: { photoKey: `db/${studentId}/${Date.now().toString(36)}`, photoBytes: data.length },
      });
      await insertAudit(tx, {
        action: "student.photo",
        schoolId: user.school.id,
        actorUserId: user.id,
        entityType: "student",
        entityId: studentId,
        details: { bytes: data.length },
      });
      return true;
    });
    if (!ok) return { error: "Student not found." };
  } catch (error) {
    if (error instanceof QuotaError) return { error: error.message };
    console.error("uploadPhoto failed", error);
    return { error: "Something went wrong. The photo was not saved." };
  }
  await remeasure(user);
  refresh();
  return { ok: true, message: "Photo saved." };
}

export async function removePhoto(_prev: FormState, formData: FormData): Promise<FormState> {
  const user = await requireSchoolAdmin();
  const studentId = toId(formData.get("studentId"));
  if (!studentId) return { error: "Invalid request." };
  await schoolDb(user, async (tx) => {
    await tx.studentPhoto.deleteMany({ where: { studentId } });
    await tx.student.updateMany({ where: { id: studentId }, data: { photoKey: null, photoBytes: null } });
  });
  await remeasure(user);
  refresh();
  return { ok: true, message: "Photo removed." };
}
