"use server";

import { redirect } from "next/navigation";
import { refresh } from "next/cache";
import { z } from "zod";
import { Prisma } from "@/generated/prisma/client";
import { requireSuperAdmin } from "@/lib/auth/dal";
import { platformDb } from "@/lib/db";
import { insertAudit } from "@/lib/audit";
import { hashPassword } from "@/lib/auth/password";
import { destroyAllSessionsForUser, getClientIp } from "@/lib/auth/session";
import { createSchoolSchema, MB, newAdminSchema, newPasswordSchema, updateSchoolSchema } from "@/lib/validation/school";
import { invalid, readFields, safeValues, toId, type FormState } from "@/lib/form";

export type CreateSchoolState =
  | {
      error?: string;
      fieldErrors?: Partial<Record<string, string[]>>;
      /** Values to put back into the form (never the password). */
      values?: Record<string, string | boolean>;
    }
  | undefined;

function text(formData: FormData, key: string): string {
  const v = formData.get(key);
  return typeof v === "string" ? v : "";
}

export async function createSchool(_prev: CreateSchoolState, formData: FormData): Promise<CreateSchoolState> {
  const user = await requireSuperAdmin();

  const raw = {
    name: text(formData, "name"),
    slug: text(formData, "slug"),
    timezone: text(formData, "timezone"),
    contactEmail: text(formData, "contactEmail"),
    contactPhone: text(formData, "contactPhone"),
    address: text(formData, "address"),
    createAdmin: formData.get("createAdmin") === "on",
    adminName: text(formData, "adminName"),
    adminEmail: text(formData, "adminEmail"),
    adminPassword: text(formData, "adminPassword"),
  };
  // Echo back what was typed if validation fails - but never the password.
  const values: Record<string, string | boolean> = { ...raw };
  delete values.adminPassword;

  const parsed = createSchoolSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      error: "Please fix the highlighted fields.",
      fieldErrors: z.flattenError(parsed.error).fieldErrors,
      values,
    };
  }
  const input = parsed.data;
  const passwordHash = input.createAdmin ? await hashPassword(input.adminPassword) : null;
  const ip = await getClientIp();

  let schoolId: number;
  try {
    schoolId = await platformDb(user, async (tx) => {
      // Friendly duplicate checks (the database also enforces these).
      if (await tx.school.findUnique({ where: { slug: input.slug }, select: { id: true } })) {
        throw new DuplicateError("slug", "This web name is already used by another school.");
      }
      if (input.createAdmin && (await tx.user.findUnique({ where: { email: input.adminEmail! }, select: { id: true } }))) {
        throw new DuplicateError("adminEmail", "A user with this email already exists.");
      }

      const school = await tx.school.create({
        data: {
          name: input.name,
          slug: input.slug,
          timezone: input.timezone,
          contactEmail: input.contactEmail,
          contactPhone: input.contactPhone,
          address: input.address,
        },
        select: { id: true },
      });
      await insertAudit(tx, {
        action: "school.create",
        actorUserId: user.id,
        schoolId: school.id,
        entityType: "school",
        entityId: school.id,
        details: { name: input.name, slug: input.slug },
        ipAddress: ip,
      });

      if (input.createAdmin && passwordHash) {
        const admin = await tx.user.create({
          data: {
            role: "SCHOOL_ADMIN",
            schoolId: school.id,
            email: input.adminEmail!,
            fullName: input.adminName!,
            passwordHash,
          },
          select: { id: true },
        });
        await insertAudit(tx, {
          action: "user.create_school_admin",
          actorUserId: user.id,
          schoolId: school.id,
          entityType: "user",
          entityId: admin.id,
          details: { email: input.adminEmail! },
          ipAddress: ip,
        });
      }
      return school.id;
    });
  } catch (error) {
    if (error instanceof DuplicateError) {
      return { error: error.message, fieldErrors: { [error.field]: [error.message] }, values };
    }
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      // Someone created the same slug/email at the same moment.
      return { error: "This web name or admin email is already in use. Please choose another.", values };
    }
    console.error("createSchool failed", error);
    return { error: "Something went wrong while saving. Nothing was created. Please try again.", values };
  }

  redirect(`/super-admin/schools/${schoolId}?created=1`);
}

class DuplicateError extends Error {
  constructor(
    public field: string,
    message: string,
  ) {
    super(message);
  }
}

export type StatusState = { error?: string } | undefined;

/** Activate or deactivate a school. Deactivation signs its admins out immediately. */
export async function setSchoolStatus(_prev: StatusState, formData: FormData): Promise<StatusState> {
  const user = await requireSuperAdmin();

  const parsed = z
    .object({ schoolId: z.coerce.number().int().positive(), status: z.enum(["ACTIVE", "INACTIVE"]) })
    .safeParse({ schoolId: formData.get("schoolId"), status: formData.get("status") });
  if (!parsed.success) return { error: "Invalid request." };
  const { schoolId, status } = parsed.data;
  const ip = await getClientIp();

  const result = await platformDb(user, async (tx) => {
    const school = await tx.school.findUnique({
      where: { id: schoolId },
      select: { status: true, users: { select: { id: true } } },
    });
    if (!school) return "missing" as const;
    if (school.status === status) return "unchanged" as const;

    await tx.school.update({ where: { id: schoolId }, data: { status } });
    await insertAudit(tx, {
      action: status === "ACTIVE" ? "school.activate" : "school.deactivate",
      actorUserId: user.id,
      schoolId,
      entityType: "school",
      entityId: schoolId,
      ipAddress: ip,
    });
    return school.users.map((u) => u.id);
  });

  if (result === "missing") return { error: "School not found." };
  if (Array.isArray(result) && status === "INACTIVE") {
    // Access is already refused on their next click; this also removes the sessions.
    for (const id of result) await destroyAllSessionsForUser(id);
  }
  refresh();
  return undefined;
}

// ---------------------------------------------------------------------
//  Phase 4b: edit school, manage School Admins
// ---------------------------------------------------------------------

const SCHOOL_FIELDS = ["name", "slug", "timezone", "contactEmail", "contactPhone", "address", "quotaOverrideMb"] as const;

export async function updateSchool(_prev: FormState, formData: FormData): Promise<FormState> {
  const user = await requireSuperAdmin();
  const schoolId = toId(formData.get("schoolId"));
  if (!schoolId) return { error: "Invalid request." };

  const values = readFields(formData, SCHOOL_FIELDS);
  const parsed = updateSchoolSchema.safeParse(values);
  if (!parsed.success) return invalid(parsed.error, values);
  const input = parsed.data;
  const ip = await getClientIp();

  try {
    const result = await platformDb(user, async (tx) => {
      const before = await tx.school.findUnique({ where: { id: schoolId } });
      if (!before) return "missing" as const;
      const clash = await tx.school.findFirst({ where: { slug: input.slug, id: { not: schoolId } }, select: { id: true } });
      if (clash) return "slug" as const;

      const quota = input.quotaOverrideMb === null ? null : BigInt(Math.round(input.quotaOverrideMb * MB));
      await tx.school.update({
        where: { id: schoolId },
        data: {
          name: input.name,
          slug: input.slug,
          timezone: input.timezone,
          contactEmail: input.contactEmail ?? null,
          contactPhone: input.contactPhone ?? null,
          address: input.address ?? null,
          storageQuotaOverrideBytes: quota,
        },
      });
      // Record what changed (old -> new) for the audit trail.
      const changes: Record<string, [string | null, string | null]> = {};
      const compare: [string, unknown, unknown][] = [
        ["name", before.name, input.name],
        ["slug", before.slug, input.slug],
        ["timezone", before.timezone, input.timezone],
        ["contactEmail", before.contactEmail, input.contactEmail ?? null],
        ["contactPhone", before.contactPhone, input.contactPhone ?? null],
        ["address", before.address, input.address ?? null],
        ["quotaOverrideBytes", before.storageQuotaOverrideBytes?.toString() ?? null, quota?.toString() ?? null],
      ];
      for (const [k, a, b] of compare) if ((a ?? null) !== (b ?? null)) changes[k] = [a as string | null, b as string | null];
      if (Object.keys(changes).length > 0) {
        await insertAudit(tx, {
          action: "school.update",
          actorUserId: user.id,
          schoolId,
          entityType: "school",
          entityId: schoolId,
          details: changes,
          ipAddress: ip,
        });
      }
      return "ok" as const;
    });
    if (result === "missing") return { error: "School not found." };
    if (result === "slug") {
      const msg = "This web name is already used by another school.";
      return { error: msg, fieldErrors: { slug: [msg] }, values };
    }
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return { error: "This web name is already in use.", values };
    }
    console.error("updateSchool failed", error);
    return { error: "Something went wrong. Nothing was changed.", values };
  }
  redirect(`/super-admin/schools/${schoolId}?saved=1`);
}

export async function addSchoolAdmin(_prev: FormState, formData: FormData): Promise<FormState> {
  const user = await requireSuperAdmin();
  const schoolId = toId(formData.get("schoolId"));
  if (!schoolId) return { error: "Invalid request." };
  const values = readFields(formData, ["fullName", "email", "password"] as const);
  const parsed = newAdminSchema.safeParse(values);
  if (!parsed.success) return invalid(parsed.error, safeValues(values));
  const input = parsed.data;
  const passwordHash = await hashPassword(input.password);
  const ip = await getClientIp();

  try {
    const result = await platformDb(user, async (tx) => {
      if (!(await tx.school.findUnique({ where: { id: schoolId }, select: { id: true } }))) return "missing" as const;
      if (await tx.user.findUnique({ where: { email: input.email }, select: { id: true } })) return "email" as const;
      const admin = await tx.user.create({
        data: { role: "SCHOOL_ADMIN", schoolId, email: input.email, fullName: input.fullName, passwordHash },
      });
      await insertAudit(tx, {
        action: "user.create_school_admin",
        actorUserId: user.id,
        schoolId,
        entityType: "user",
        entityId: admin.id,
        details: { email: input.email },
        ipAddress: ip,
      });
      return "ok" as const;
    });
    if (result === "missing") return { error: "School not found." };
    if (result === "email") {
      const msg = "A user with this email already exists.";
      return { error: msg, fieldErrors: { email: [msg] }, values: safeValues(values) };
    }
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return { error: "A user with this email already exists.", values: safeValues(values) };
    }
    console.error("addSchoolAdmin failed", error);
    return { error: "Something went wrong. Nothing was created.", values: safeValues(values) };
  }
  refresh();
  return { ok: true, message: `Admin ${input.email} added. Share the password with them securely.` };
}

/** Super Admin sets a new password for a School Admin (e.g. forgotten password). */
export async function resetAdminPassword(_prev: FormState, formData: FormData): Promise<FormState> {
  const user = await requireSuperAdmin();
  const adminId = toId(formData.get("userId"));
  if (!adminId) return { error: "Invalid request." };
  const parsed = newPasswordSchema.safeParse({ password: formData.get("password") ?? "" });
  if (!parsed.success) return invalid(parsed.error);
  const passwordHash = await hashPassword(parsed.data.password);
  const ip = await getClientIp();

  const result = await platformDb(user, async (tx) => {
    const admin = await tx.user.findUnique({ where: { id: adminId }, select: { role: true, schoolId: true, email: true } });
    if (!admin || admin.role !== "SCHOOL_ADMIN") return null;
    await tx.user.update({
      where: { id: adminId },
      data: { passwordHash, passwordChangedAt: new Date(), failedLoginCount: 0, lockedUntil: null },
    });
    await insertAudit(tx, {
      action: "user.reset_password",
      actorUserId: user.id,
      schoolId: admin.schoolId,
      entityType: "user",
      entityId: adminId,
      ipAddress: ip,
    });
    return admin;
  });
  if (!result) return { error: "Admin not found." };
  // Old password is dead everywhere: sign them out on all devices.
  await destroyAllSessionsForUser(adminId);
  refresh();
  return { ok: true, message: `New password set for ${result.email}. They have been signed out everywhere.` };
}

export async function setAdminActive(_prev: FormState, formData: FormData): Promise<FormState> {
  const user = await requireSuperAdmin();
  const adminId = toId(formData.get("userId"));
  const active = formData.get("active") === "true";
  if (!adminId) return { error: "Invalid request." };
  const ip = await getClientIp();

  const ok = await platformDb(user, async (tx) => {
    const admin = await tx.user.findUnique({ where: { id: adminId }, select: { role: true, schoolId: true } });
    if (!admin || admin.role !== "SCHOOL_ADMIN") return false;
    await tx.user.update({ where: { id: adminId }, data: { isActive: active, failedLoginCount: 0, lockedUntil: null } });
    await insertAudit(tx, {
      action: active ? "user.enable" : "user.disable",
      actorUserId: user.id,
      schoolId: admin.schoolId,
      entityType: "user",
      entityId: adminId,
      ipAddress: ip,
    });
    return true;
  });
  if (!ok) return { error: "Admin not found." };
  if (!active) await destroyAllSessionsForUser(adminId);
  refresh();
  return { ok: true };
}
