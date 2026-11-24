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
import { createSchoolSchema } from "@/lib/validation/school";

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
