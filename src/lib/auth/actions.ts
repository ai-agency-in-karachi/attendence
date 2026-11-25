"use server";

import { redirect } from "next/navigation";
import { systemDb } from "@/lib/db";
import { writeAudit } from "@/lib/audit";
import {
  getDummyHash,
  hashPassword,
  verifyPassword,
  PASSWORD_MAX_LENGTH,
} from "@/lib/auth/password";
import { changeOwnPasswordSchema } from "@/lib/validation/school";
import { invalid, type FormState } from "@/lib/form";
import {
  createSession,
  destroyAllSessionsForUser,
  destroyCurrentSession,
  getClientIp,
} from "@/lib/auth/session";
import { getCurrentUser, homePathFor } from "@/lib/auth/dal";

const MAX_FAILED_ATTEMPTS = 5;
const LOCKOUT_MINUTES = 15;

const GENERIC_ERROR = "Invalid email or password.";

export type LoginState = { error?: string; email?: string } | undefined;

export async function login(
  _prev: LoginState,
  formData: FormData,
): Promise<LoginState> {
  const rawEmail = formData.get("email");
  const rawPassword = formData.get("password");
  const email =
    typeof rawEmail === "string" ? rawEmail.trim().toLowerCase() : "";
  const password = typeof rawPassword === "string" ? rawPassword : "";

  if (
    !email ||
    !password ||
    email.length > 254 ||
    password.length > PASSWORD_MAX_LENGTH
  ) {
    return { error: "Please enter your email and password.", email };
  }

  const ip = await getClientIp();
  // System scope: we don't know who (or which school) this is yet.
  const user = await systemDb((tx) =>
    tx.user.findUnique({
      where: { email },
      select: {
        id: true,
        role: true,
        schoolId: true,
        isActive: true,
        passwordHash: true,
        lockedUntil: true,
        school: { select: { status: true } },
      },
    }),
  );

  // Unknown email: still spend the same time hashing, then fail generically.
  if (!user) {
    await verifyPassword(password, await getDummyHash());
    await writeAudit({
      action: "auth.login_failed",
      details: { reason: "unknown_email" },
      ipAddress: ip,
    });
    return { error: GENERIC_ERROR, email };
  }

  if (user.lockedUntil && user.lockedUntil > new Date()) {
    const minutes = Math.ceil(
      (user.lockedUntil.getTime() - Date.now()) / 60000,
    );
    return {
      error: `Too many failed attempts. Please try again in ${minutes} minute${minutes === 1 ? "" : "s"}.`,
      email,
    };
  }

  const passwordOk = await verifyPassword(password, user.passwordHash);

  if (!passwordOk) {
    // Atomic increment, so parallel attempts are all counted.
    const locked = await systemDb(async (tx) => {
      const updated = await tx.user.update({
        where: { id: user.id },
        data: { failedLoginCount: { increment: 1 } },
        select: { failedLoginCount: true },
      });
      if (updated.failedLoginCount < MAX_FAILED_ATTEMPTS) return false;
      await tx.user.update({
        where: { id: user.id },
        data: {
          failedLoginCount: 0,
          lockedUntil: new Date(Date.now() + LOCKOUT_MINUTES * 60000),
        },
      });
      return true;
    });
    await writeAudit({
      action: locked ? "auth.locked" : "auth.login_failed",
      schoolId: user.schoolId,
      actorUserId: user.id,
      details: { reason: "wrong_password" },
      ipAddress: ip,
    });
    return { error: GENERIC_ERROR, email };
  }

  // Correct password, but the account or its school is switched off.
  const schoolInactive =
    user.role === "SCHOOL_ADMIN" && user.school?.status !== "ACTIVE";
  if (!user.isActive || schoolInactive) {
    await writeAudit({
      action: "auth.login_blocked",
      schoolId: user.schoolId,
      actorUserId: user.id,
      details: { reason: !user.isActive ? "user_inactive" : "school_inactive" },
      ipAddress: ip,
    });
    return {
      error:
        "This account is currently disabled. Please contact the platform administrator.",
      email,
    };
  }

  await systemDb((tx) =>
    tx.user.update({
      where: { id: user.id },
      data: { failedLoginCount: 0, lockedUntil: null, lastLoginAt: new Date() },
    }),
  );
  await createSession(user.id);
  await writeAudit({
    action: "auth.login",
    schoolId: user.schoolId,
    actorUserId: user.id,
    ipAddress: ip,
  });

  redirect(homePathFor(user.role));
}

export async function logout(): Promise<void> {
  const user = await getCurrentUser();
  await destroyCurrentSession();
  if (user) {
    await writeAudit({
      action: "auth.logout",
      schoolId: user.school?.id ?? null,
      actorUserId: user.id,
      ipAddress: await getClientIp(),
    });
  }
  redirect("/login");
}

/** Any signed-in user changes their own password (needs the current one). */
export async function changeOwnPassword(_prev: FormState, formData: FormData): Promise<FormState> {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const parsed = changeOwnPasswordSchema.safeParse({
    currentPassword: formData.get("currentPassword") ?? "",
    newPassword: formData.get("newPassword") ?? "",
    confirmPassword: formData.get("confirmPassword") ?? "",
  });
  if (!parsed.success) return invalid(parsed.error);

  // System scope, limited to the verified session's own user id.
  const current = await systemDb((tx) =>
    tx.user.findUnique({ where: { id: user.id }, select: { passwordHash: true } }),
  );
  if (!current || !(await verifyPassword(parsed.data.currentPassword, current.passwordHash))) {
    const msg = "Your current password is not correct.";
    return { error: msg, fieldErrors: { currentPassword: [msg] } };
  }

  const passwordHash = await hashPassword(parsed.data.newPassword);
  await systemDb((tx) =>
    tx.user.update({
      where: { id: user.id },
      data: { passwordHash, passwordChangedAt: new Date() },
    }),
  );
  // Sign out every other device, then give this browser a fresh session.
  await destroyAllSessionsForUser(user.id);
  await createSession(user.id);
  await writeAudit({
    action: "user.change_own_password",
    schoolId: user.school?.id ?? null,
    actorUserId: user.id,
    entityType: "user",
    entityId: user.id,
    ipAddress: await getClientIp(),
  });
  return { ok: true, message: "Password changed. You were signed out on all other devices." };
}
