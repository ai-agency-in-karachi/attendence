import "server-only";
import { cache } from "react";
import { redirect } from "next/navigation";
import { readSession } from "@/lib/auth/session";

/**
 * Data Access Layer for authentication and authorization.
 *
 * EVERY protected page, Server Action and Route Handler must call one of
 * requireSuperAdmin() / requireSchoolAdmin() before reading or changing
 * data. Proxy only does a quick cookie check; this is the real gate.
 */

export type CurrentUser = {
  id: number;
  role: "SUPER_ADMIN" | "SCHOOL_ADMIN";
  email: string;
  fullName: string;
  /** Present only for School Admins. */
  school: { id: number; name: string; slug: string; timezone: string } | null;
};

/**
 * Returns the logged-in user, or null. Cached for the duration of one
 * request, so calling it many times costs one database query.
 * Deactivated users, and admins of deactivated schools, count as logged out.
 */
export const getCurrentUser = cache(async (): Promise<CurrentUser | null> => {
  const session = await readSession();
  if (!session) return null;

  const { user } = session;
  if (!user.isActive) return null;

  if (user.role === "SCHOOL_ADMIN") {
    if (!user.school || user.school.status !== "ACTIVE") return null;
  }

  return {
    id: user.id,
    role: user.role,
    email: user.email,
    fullName: user.fullName,
    school:
      user.role === "SCHOOL_ADMIN" && user.school
        ? {
            id: user.school.id,
            name: user.school.name,
            slug: user.school.slug,
            timezone: user.school.timezone,
          }
        : null,
  };
});

/** Where each role lands after logging in. */
export function homePathFor(role: CurrentUser["role"]): string {
  return role === "SUPER_ADMIN" ? "/super-admin" : "/school";
}

export async function requireUser(): Promise<CurrentUser> {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  return user;
}

export async function requireSuperAdmin(): Promise<CurrentUser> {
  const user = await requireUser();
  if (user.role !== "SUPER_ADMIN") redirect(homePathFor(user.role));
  return user;
}

export type SchoolAdminContext = CurrentUser & {
  school: NonNullable<CurrentUser["school"]>;
};

/**
 * Returns the School Admin together with THEIR school. All school data
 * queries must filter by `school.id` taken from here - never from the URL,
 * a form field or anything else the browser sends.
 */
export async function requireSchoolAdmin(): Promise<SchoolAdminContext> {
  const user = await requireUser();
  if (user.role !== "SCHOOL_ADMIN" || !user.school) redirect(homePathFor(user.role));
  return user as SchoolAdminContext;
}
