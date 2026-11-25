import { toId } from "@/lib/form";
import { isMonth } from "@/lib/dates";
import { one, type SearchParams } from "@/lib/params";
import type { RegisterFilters } from "@/lib/register";

/** Reads register filters from the URL (shared by the page and the CSV export). */
export function registerFilters(sp: SearchParams, today: string): RegisterFilters & { classParam: string } {
  const m = one(sp.month);
  const classParam = one(sp.class);
  return {
    month: isMonth(m) ? m : today.slice(0, 7),
    classParam,
    classId: classParam === "none" ? "none" : toId(classParam),
    q: one(sp.q).trim().slice(0, 100),
    includeInactive: one(sp.inactive) === "1",
  };
}
