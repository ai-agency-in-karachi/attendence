import "server-only";
import { systemDb, type Tx } from "@/lib/db";
import { isCurrent } from "@/lib/billing";

/*
 * Storage engine: measures how much space a school uses and enforces its quota.
 *
 * Usage = actual size of the school's student and class rows (measured by
 * PostgreSQL) + a fixed estimate per attendance row and per student for
 * index overhead + the exact size of stored photos.
 *
 * Quota  = the school's custom quota (set by the Super Admin), otherwise
 * the storage limit of its CURRENT subscription. No current subscription
 * and no custom quota => no room for new data (but existing data and
 * attendance keep working).
 *
 * Attendance is never blocked by the quota: a school must always be able
 * to take attendance. The quota blocks NEW students, imports and photos.
 */

/** Estimated bytes for one attendance row including its index entries. */
export const ATTENDANCE_ROW_BYTES = 96;
/** Estimated index + row-header overhead per student (on top of the measured row size). */
export const STUDENT_OVERHEAD_BYTES = 160;
/** Estimate for a brand-new student row before it exists (row + overhead). */
export const NEW_STUDENT_BYTES = 420;

/** Show a warning from this fraction of the quota. */
export const WARN_AT = 0.8;

export type Usage = {
  students: number;
  attendance: number;
  photos: number;
  other: number;
  total: number;
};

/** Measures a school's current usage. Works in school scope (own school) and platform scope. */
export async function measureUsage(tx: Tx, schoolId: number): Promise<Usage> {
  const [row] = await tx.$queryRaw<
    { students: bigint; student_rows: bigint; attendance_rows: bigint; classes: bigint; photos: bigint }[]
  >`
    SELECT
      (SELECT coalesce(sum(pg_column_size(s.*)), 0) FROM students s WHERE s.school_id = ${schoolId})::bigint AS students,
      (SELECT count(*) FROM students WHERE school_id = ${schoolId})::bigint AS student_rows,
      (SELECT count(*) FROM attendance WHERE school_id = ${schoolId})::bigint AS attendance_rows,
      (SELECT coalesce(sum(pg_column_size(c.*)), 0) FROM class_groups c WHERE c.school_id = ${schoolId})::bigint AS classes,
      (SELECT coalesce(sum(bytes), 0) FROM student_photos WHERE school_id = ${schoolId})::bigint AS photos`;
  const students = Number(row.students) + Number(row.student_rows) * STUDENT_OVERHEAD_BYTES;
  const attendance = Number(row.attendance_rows) * ATTENDANCE_ROW_BYTES;
  const photos = Number(row.photos);
  const other = Number(row.classes);
  return { students, attendance, photos, other, total: students + attendance + photos + other };
}

export type Quota = {
  limit: number | null;
  source: "custom" | "plan" | "none";
};

/** The school's storage limit in bytes (null = no plan and no custom quota). */
export async function getQuota(tx: Tx, schoolId: number): Promise<Quota> {
  const school = await tx.school.findUnique({
    where: { id: schoolId },
    select: {
      storageQuotaOverrideBytes: true,
      subscriptions: {
        where: { status: { in: ["ACTIVE", "TRIAL"] } },
        select: { status: true, startsAt: true, endsAt: true, storageLimitBytes: true },
      },
    },
  });
  if (school?.storageQuotaOverrideBytes) return { limit: Number(school.storageQuotaOverrideBytes), source: "custom" };
  const sub = school?.subscriptions.find((s) => isCurrent(s));
  if (sub) return { limit: Number(sub.storageLimitBytes), source: "plan" };
  return { limit: null, source: "none" };
}

export type StorageStatus = Usage & {
  quota: Quota;
  /** 0..100+ (null when there is no quota). */
  percent: number | null;
  level: "ok" | "warning" | "full" | "none";
  remaining: number;
};

export async function storageStatus(tx: Tx, schoolId: number): Promise<StorageStatus> {
  const [usage, quota] = await Promise.all([measureUsage(tx, schoolId), getQuota(tx, schoolId)]);
  return describe(usage, quota);
}

export function describe(usage: Usage, quota: Quota): StorageStatus {
  if (quota.limit === null) return { ...usage, quota, percent: null, level: "none", remaining: 0 };
  const percent = Math.round((usage.total / quota.limit) * 1000) / 10;
  const level = usage.total >= quota.limit ? "full" : usage.total >= quota.limit * WARN_AT ? "warning" : "ok";
  return { ...usage, quota, percent, level, remaining: Math.max(0, quota.limit - usage.total) };
}

export class QuotaError extends Error {}

/**
 * Throws QuotaError if adding `extraBytes` would exceed the school's quota.
 * Call INSIDE the same transaction that writes the data.
 */
export async function assertRoom(tx: Tx, schoolId: number, extraBytes: number): Promise<StorageStatus> {
  const status = await storageStatus(tx, schoolId);
  if (status.quota.limit === null) {
    throw new QuotaError("Your school has no active subscription, so new data cannot be added. Please contact the platform administrator.");
  }
  if (status.total + extraBytes > status.quota.limit) {
    throw new QuotaError(
      status.level === "full"
        ? "Your storage is full. Remove photos or old students, or ask the platform administrator for more storage."
        : "Not enough storage left for this. Please ask the platform administrator for more storage.",
    );
  }
  return status;
}

/**
 * Saves the latest measurement on the school row (shown in the Super Admin
 * panel). School Admins cannot write the schools table, so this internal
 * bookkeeping runs in system scope for the given (already verified) school.
 */
export async function saveUsage(schoolId: number, totalBytes: number): Promise<void> {
  try {
    await systemDb((tx) =>
      tx.school.update({
        where: { id: schoolId },
        data: { storageUsedBytes: BigInt(Math.max(0, Math.round(totalBytes))), storageCalculatedAt: new Date() },
      }),
    );
  } catch (error) {
    console.error("saveUsage failed", schoolId, error);
  }
}

/** Saves a fresh measurement when the stored one is older than 10 minutes. */
export async function saveUsageIfStale(schoolId: number, calculatedAt: Date | null, totalBytes: number): Promise<void> {
  if (calculatedAt && Date.now() - calculatedAt.getTime() < 10 * 60_000) return;
  await saveUsage(schoolId, totalBytes);
}
