"use server";

import { refresh } from "next/cache";
import { requireSchoolAdmin } from "@/lib/auth/dal";
import { schoolDb } from "@/lib/db";
import { insertAudit } from "@/lib/audit";
import { dateOnlyToDb, isDateOnly, todayInZone } from "@/lib/dates";
import { toId, type FormState } from "@/lib/form";

export type SetResult = { ok: true } | { ok: false; error: string };

/**
 * Sets one student's attendance for one day by hand:
 * "PRESENT", "ABSENT" or null (= no record). Future days are refused.
 */
export async function setAttendance(studentId: number, date: string, status: "PRESENT" | "ABSENT" | null): Promise<SetResult> {
  const user = await requireSchoolAdmin();
  if (!Number.isSafeInteger(studentId) || studentId <= 0 || typeof date !== "string" || !isDateOnly(date)) {
    return { ok: false, error: "Invalid request." };
  }
  if (status !== null && status !== "PRESENT" && status !== "ABSENT") return { ok: false, error: "Invalid request." };
  if (date > todayInZone(user.school.timezone)) return { ok: false, error: "You can’t mark attendance for a future day." };

  const day = dateOnlyToDb(date);
  return schoolDb(user, async (tx) => {
    // Row-Level Security: a student of another school is simply not found.
    const s = await tx.student.findUnique({ where: { id: studentId }, select: { id: true } });
    if (!s) return { ok: false, error: "Student not found." } as const;
    const key = { studentId_date: { studentId, date: day } };
    const before = await tx.attendance.findUnique({ where: key, select: { status: true } });
    if ((before?.status ?? null) === status) return { ok: true } as const;

    if (status === null) {
      await tx.attendance.delete({ where: key });
    } else {
      const data = { status, source: "MANUAL" as const, markedAt: new Date(), markedById: user.id };
      await tx.attendance.upsert({ where: key, create: { studentId, date: day, schoolId: user.school.id, ...data }, update: data });
    }
    await insertAudit(tx, {
      action: "attendance.update",
      schoolId: user.school.id,
      actorUserId: user.id,
      entityType: "attendance",
      entityId: `${studentId}:${date}`,
      details: { from: before?.status ?? null, to: status },
    });
    return { ok: true } as const;
  });
}

/** Marks every active student WITHOUT a record that day as absent (optionally one class only). */
export async function markRestAbsent(_prev: FormState, formData: FormData): Promise<FormState> {
  const user = await requireSchoolAdmin();
  const date = String(formData.get("date") ?? "");
  const classId = formData.get("classId") ? toId(formData.get("classId")) : null;
  if (!isDateOnly(date)) return { error: "Invalid date." };
  if (date > todayInZone(user.school.timezone)) return { error: "You can’t mark a future day." };

  const count = await schoolDb(user, async (tx) => {
    const n = await tx.$executeRaw`
      INSERT INTO attendance (student_id, date, school_id, status, source, marked_at, marked_by_id)
      SELECT s.id, ${dateOnlyToDb(date)}::date, s.school_id, 'ABSENT'::attendance_status, 'MANUAL'::attendance_source, now(), ${user.id}
      FROM students s
      WHERE s.status = 'ACTIVE' AND s.school_id = ${user.school.id}
        AND (${classId}::int IS NULL OR s.class_group_id = ${classId}::int)
      ON CONFLICT (student_id, date) DO NOTHING`;
    if (n > 0) {
      await insertAudit(tx, {
        action: "attendance.mark_rest_absent",
        schoolId: user.school.id,
        actorUserId: user.id,
        entityType: "attendance",
        entityId: date,
        details: { count: n, classId },
      });
    }
    return n;
  });
  refresh();
  return { ok: true, message: count ? `${count} student${count === 1 ? "" : "s"} marked absent.` : "Everyone already has a mark for that day." };
}
