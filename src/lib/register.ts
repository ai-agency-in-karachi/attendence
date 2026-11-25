import "server-only";
import type { Prisma } from "@/generated/prisma/client";
import type { Tx } from "@/lib/db";
import { dateOnlyToDb, daysOfMonth, dbToDateOnly, shiftMonth, weekday } from "@/lib/dates";

export type Mark = "P" | "A";

export type RegisterFilters = {
  month: string; // YYYY-MM
  classId: number | "none" | null;
  q: string;
  includeInactive: boolean;
};

export type RegisterDay = { date: string; day: number; weekday: string; weekend: boolean; isToday: boolean; isFuture: boolean };

export type RegisterRow = {
  id: number;
  fullName: string;
  studentCode: string;
  className: string | null;
  active: boolean;
  marks: Record<string, Mark>;
  present: number;
  absent: number;
};

export type Register = {
  days: RegisterDay[];
  rows: RegisterRow[];
  total: number;
  /** Days this month (up to today) on which the school recorded any attendance. */
  schoolDays: number;
  dayTotals: Record<string, number>;
};

const WEEKDAY = ["S", "M", "T", "W", "T", "F", "S"];

export function studentWhere(f: RegisterFilters): Prisma.StudentWhereInput {
  return {
    ...(f.includeInactive ? {} : { status: "ACTIVE" }),
    ...(f.classId === "none" ? { classGroupId: null } : f.classId ? { classGroupId: f.classId } : {}),
    ...(f.q && { OR: [{ fullName: { contains: f.q, mode: "insensitive" } }, { studentCode: { contains: f.q, mode: "insensitive" } }] }),
  };
}

/** Loads one month of the register. `page` = null loads every matching student (for export). */
export async function loadRegister(tx: Tx, f: RegisterFilters, today: string, page: { skip: number; take: number } | null): Promise<Register> {
  const from = dateOnlyToDb(`${f.month}-01`);
  const to = dateOnlyToDb(`${shiftMonth(f.month, 1)}-01`);
  const where = studentWhere(f);

  const [total, students, schoolDayRows] = await Promise.all([
    tx.student.count({ where }),
    tx.student.findMany({
      where,
      orderBy: [{ classGroup: { sortOrder: "asc" } }, { classGroup: { name: "asc" } }, { fullName: "asc" }, { id: "asc" }],
      ...(page ?? {}),
      select: { id: true, fullName: true, studentCode: true, status: true, classGroup: { select: { name: true } } },
    }),
    tx.attendance.groupBy({ by: ["date"], where: { date: { gte: from, lt: to }, status: "PRESENT" } }),
  ]);

  const ids = students.map((s) => s.id);
  const records = ids.length
    ? await tx.attendance.findMany({
        where: { studentId: { in: ids }, date: { gte: from, lt: to } },
        select: { studentId: true, date: true, status: true },
      })
    : [];

  const days = daysOfMonth(f.month).map((date) => ({
    date,
    day: Number(date.slice(8)),
    weekday: WEEKDAY[weekday(date)],
    weekend: weekday(date) === 0 || weekday(date) === 6,
    isToday: date === today,
    isFuture: date > today,
  }));

  const byStudent = new Map<number, Record<string, Mark>>();
  const dayTotals: Record<string, number> = {};
  for (const r of records) {
    const d = dbToDateOnly(r.date);
    const m = byStudent.get(r.studentId) ?? {};
    m[d] = r.status === "PRESENT" ? "P" : "A";
    byStudent.set(r.studentId, m);
    if (r.status === "PRESENT") dayTotals[d] = (dayTotals[d] ?? 0) + 1;
  }

  const rows = students.map((s) => {
    const marks = byStudent.get(s.id) ?? {};
    const values = Object.values(marks);
    return {
      id: s.id,
      fullName: s.fullName,
      studentCode: s.studentCode,
      className: s.classGroup?.name ?? null,
      active: s.status === "ACTIVE",
      marks,
      present: values.filter((v) => v === "P").length,
      absent: values.filter((v) => v === "A").length,
    };
  });

  return { days, rows, total, dayTotals, schoolDays: schoolDayRows.filter((r) => dbToDateOnly(r.date) <= today).length };
}
