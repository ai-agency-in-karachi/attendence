"use server";

import { refresh } from "next/cache";
import { requireSuperAdmin } from "@/lib/auth/dal";
import { platformDb } from "@/lib/db";
import { measureUsage } from "@/lib/storage";
import type { FormState } from "@/lib/form";

/** Re-measures every school's storage and saves the numbers. */
export async function recalculateAllStorage(): Promise<FormState> {
  const user = await requireSuperAdmin();
  const count = await platformDb(
    user,
    async (tx) => {
      const schools = await tx.school.findMany({ select: { id: true } });
      for (const s of schools) {
        const usage = await measureUsage(tx, s.id);
        await tx.school.update({
          where: { id: s.id },
          data: { storageUsedBytes: BigInt(usage.total), storageCalculatedAt: new Date() },
        });
      }
      return schools.length;
    },
    { timeout: 120_000 },
  );
  refresh();
  return { ok: true, message: `Measured ${count} school${count === 1 ? "" : "s"}.` };
}
