import { requireSchoolAdmin } from "@/lib/auth/dal";
import { schoolDb } from "@/lib/db";
import { todayInZone } from "@/lib/dates";
import { loadRegister } from "@/lib/register";
import { registerFilters } from "@/lib/register-params";

/** Excel could run text starting with = + - @ as a formula ("CSV injection"): prefix it with '. */
function cell(v: string | number): string {
  let s = String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** CSV of the register for the selected month and filters (all students, no paging). */
export async function GET(req: Request) {
  const user = await requireSchoolAdmin();
  const sp = Object.fromEntries(new URL(req.url).searchParams);
  const today = todayInZone(user.school.timezone);
  const f = registerFilters(sp, today);
  const reg = await schoolDb(user, (tx) => loadRegister(tx, f, today, null), { timeout: 60_000 });

  const header = ["Student ID", "Full Name", "Class", "Status", ...reg.days.map((d) => d.date), "Present", "Absent", "Present %"];
  const lines = [header.map(cell).join(",")];
  for (const r of reg.rows) {
    lines.push(
      [
        r.studentCode,
        r.fullName,
        r.className ?? "",
        r.active ? "Active" : "Inactive",
        ...reg.days.map((d) => r.marks[d.date] ?? ""),
        r.present,
        r.absent,
        reg.schoolDays ? Math.round((r.present / reg.schoolDays) * 100) : 0,
      ]
        .map(cell)
        .join(","),
    );
  }
  const slug = user.school.slug.replace(/[^a-z0-9-]/g, "");
  return new Response(`﻿${lines.join("\r\n")}\r\n`, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="attendance-${slug}-${f.month}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
