import "server-only";
import { io } from "next/cache";
import { prisma } from "@/lib/prisma";
import {
  withPlatformScope,
  withSchoolScope,
  withSystemScope,
  type Tx,
} from "@/lib/db-scope";
import type { CurrentUser, SchoolAdminContext } from "@/lib/auth/dal";

/**
 * The ONLY way app code should touch the database.
 *
 *   const user = await requireSchoolAdmin();
 *   const students = await schoolDb(user, tx => tx.student.findMany());
 *
 * The school comes from the verified session - never from the URL or a
 * form - and PostgreSQL itself filters every query to that school.
 */

export type { Tx };

/*
 * `await io()` tells Next.js that request-time work follows: Prisma
 * transactions create random ids (crypto.randomUUID) and we compare
 * against the current time, which must never be baked into a
 * prerendered page shell.
 */

type Options = { timeout?: number };

/** School Admin work: sees and changes only their own school's rows. */
export async function schoolDb<T>(
  user: SchoolAdminContext,
  fn: (tx: Tx) => Promise<T>,
  options?: Options,
) {
  await io();
  return withSchoolScope(prisma, user.school.id, fn, options);
}

/** Super Admin work: whole platform. Re-checks the role as a safety net. */
export async function platformDb<T>(
  user: CurrentUser,
  fn: (tx: Tx) => Promise<T>,
  options?: Options,
) {
  if (user.role !== "SUPER_ADMIN") {
    throw new Error("platformDb: Super Admin required");
  }
  await io();
  return withPlatformScope(prisma, fn, options);
}

/** Internal plumbing only (login, sessions, audit). Not for user-requested data. */
export async function systemDb<T>(fn: (tx: Tx) => Promise<T>, options?: Options) {
  await io();
  return withSystemScope(prisma, fn, options);
}
