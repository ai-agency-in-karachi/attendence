import type { Prisma, PrismaClient } from "@/generated/prisma/client";

/**
 * Row-Level Security context.
 *
 * The database only shows rows the current "scope" is allowed to see
 * (see prisma/migrations/*_row_level_security). Every database read or
 * write in the app must run inside one of these:
 *
 *   withSchoolScope(db, schoolId, tx => ...)   School Admin: own school only
 *   withPlatformScope(db, tx => ...)           Super Admin: whole platform
 *   withSystemScope(db, tx => ...)             Login/session internals ONLY
 *
 * Using the plain client outside a scope returns no rows (fails closed).
 *
 * Each scope is one database transaction. The settings are
 * transaction-local, so they disappear at the end and can never leak into
 * another request that reuses the same pooled connection.
 *
 * This file has no Next.js imports, so command-line scripts can use it.
 */

export type Tx = Prisma.TransactionClient;
type Role = "school_admin" | "super_admin" | "system";

type ScopeOptions = {
  /** Max run time in ms (default 10 s). Raise for big jobs like imports. */
  timeout?: number;
};

async function runScoped<T>(
  db: PrismaClient,
  role: Role,
  schoolId: number | null,
  fn: (tx: Tx) => Promise<T>,
  options?: ScopeOptions,
): Promise<T> {
  return db.$transaction(
    async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.role', ${role}, true),
                                  set_config('app.school_id', ${schoolId === null ? "" : String(schoolId)}, true)`;
      return fn(tx);
    },
    { timeout: options?.timeout ?? 10_000, maxWait: 5_000 },
  );
}

export function withSchoolScope<T>(
  db: PrismaClient,
  schoolId: number,
  fn: (tx: Tx) => Promise<T>,
  options?: ScopeOptions,
): Promise<T> {
  if (!Number.isSafeInteger(schoolId) || schoolId <= 0) {
    throw new Error("withSchoolScope: invalid school id");
  }
  return runScoped(db, "school_admin", schoolId, fn, options);
}

export function withPlatformScope<T>(
  db: PrismaClient,
  fn: (tx: Tx) => Promise<T>,
  options?: ScopeOptions,
): Promise<T> {
  return runScoped(db, "super_admin", null, fn, options);
}

/**
 * Unrestricted access for internal plumbing that runs BEFORE we know who
 * the user is (login, session checks, audit writes, CLI scripts).
 * Never use it for anything a user asked to see or change.
 */
export function withSystemScope<T>(
  db: PrismaClient,
  fn: (tx: Tx) => Promise<T>,
  options?: ScopeOptions,
): Promise<T> {
  return runScoped(db, "system", null, fn, options);
}
