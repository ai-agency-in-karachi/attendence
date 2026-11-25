"use server";

import { requireSchoolAdmin } from "@/lib/auth/dal";
import { schoolDb } from "@/lib/db";
import { dateOnlyToDb, todayInZone, timeInZone } from "@/lib/dates";
import { tokenFromScan } from "@/lib/students";
import type { ScanResult } from "./types";

/**
 * Marks a student present from a scanned QR code.
 *
 * - The token is looked up inside the School Admin's own school only
 *   (Row-Level Security), so a card from another school is "unknown".
 * - The day is the school's local calendar day (its time zone).
 * - One attendance per student per day: the database key (student, date)
 *   makes a second scan a harmless "already marked", even if two scans
 *   arrive at the same moment.
 */
export async function scanQr(raw: string): Promise<ScanResult> {
  const user = await requireSchoolAdmin();
  if (typeof raw !== "string" || raw.length > 200) return { kind: "invalid" };
  const token = tokenFromScan(raw);
  if (!token) return { kind: "invalid" };

  const tz = user.school.timezone;
  const today = todayInZone(tz);

  return schoolDb(user, async (tx) => {
    const s = await tx.student.findUnique({
      where: { qrToken: token },
      select: { id: true, fullName: true, studentCode: true, status: true, photoKey: true, classGroup: { select: { name: true } } },
    });
    if (!s) return { kind: "unknown" } as const;
    const student = { id: s.id, fullName: s.fullName, studentCode: s.studentCode, photoKey: s.photoKey, className: s.classGroup?.name ?? null };
    if (s.status !== "ACTIVE") return { kind: "inactive", student } as const;

    const date = dateOnlyToDb(today);
    const inserted = await tx.$queryRaw<{ marked_at: Date }[]>`
      INSERT INTO attendance (student_id, date, school_id, status, source, marked_at)
      VALUES (${s.id}, ${date}::date, ${user.school.id}, 'PRESENT'::attendance_status, 'QR_SCAN'::attendance_source, now())
      ON CONFLICT (student_id, date) DO NOTHING
      RETURNING marked_at`;
    if (inserted.length) {
      return { kind: "ok", student, time: timeInZone(inserted[0].marked_at, tz) } as const;
    }

    const existing = await tx.attendance.findUniqueOrThrow({ where: { studentId_date: { studentId: s.id, date } } });
    if (existing.status === "ABSENT") {
      // Marked absent by hand earlier, but the student has now arrived.
      const updated = await tx.attendance.update({
        where: { studentId_date: { studentId: s.id, date } },
        data: { status: "PRESENT", source: "QR_SCAN", markedAt: new Date(), markedById: null },
      });
      return { kind: "ok", student, time: timeInZone(updated.markedAt, tz) } as const;
    }
    return { kind: "duplicate", student, time: timeInZone(existing.markedAt, tz) } as const;
  });
}
