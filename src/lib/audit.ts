import "server-only";
import { prisma } from "@/lib/prisma";
import type { Prisma } from "@/generated/prisma/client";

export type AuditEntry = {
  /** e.g. "auth.login", "auth.login_failed", "school.deactivate" */
  action: string;
  schoolId?: number | null;
  actorUserId?: number | null;
  entityType?: string;
  entityId?: string | number;
  /** Small extra details. NEVER include passwords, tokens or secrets. */
  details?: Prisma.InputJsonValue;
  ipAddress?: string | null;
};

/**
 * Writes an audit log entry. A failure here is logged but never breaks
 * the user's action (the main operation matters more than its log).
 */
export async function writeAudit(entry: AuditEntry): Promise<void> {
  try {
    await prisma.auditLog.create({
      data: {
        action: entry.action,
        schoolId: entry.schoolId ?? null,
        actorUserId: entry.actorUserId ?? null,
        entityType: entry.entityType,
        entityId: entry.entityId === undefined ? undefined : String(entry.entityId),
        details: entry.details,
        ipAddress: entry.ipAddress ?? null,
      },
    });
  } catch (error) {
    console.error("Audit log write failed", entry.action, error);
  }
}
