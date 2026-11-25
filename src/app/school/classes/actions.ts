"use server";

import { refresh } from "next/cache";
import { Prisma } from "@/generated/prisma/client";
import { requireSchoolAdmin } from "@/lib/auth/dal";
import { schoolDb } from "@/lib/db";
import { insertAudit } from "@/lib/audit";
import { invalid, readFields, toId, type FormState } from "@/lib/form";
import { classSchema } from "@/lib/validation/student";

/*
 * Classes / sections. All queries run in the School Admin's own school
 * scope: PostgreSQL itself refuses rows of any other school.
 */

export async function saveClass(_prev: FormState, formData: FormData): Promise<FormState> {
  const user = await requireSchoolAdmin();
  const classId = formData.get("classId") ? toId(formData.get("classId")) : null;
  if (formData.get("classId") && !classId) return { error: "Invalid request." };
  const values = readFields(formData, ["name", "sortOrder"] as const);
  const parsed = classSchema.safeParse(values);
  if (!parsed.success) return invalid(parsed.error, values);
  const { name, sortOrder } = parsed.data;

  try {
    const result = await schoolDb(user, async (tx) => {
      const clash = await tx.classGroup.findFirst({
        where: { name: { equals: name, mode: "insensitive" }, ...(classId && { id: { not: classId } }) },
        select: { id: true },
      });
      if (clash) return "dup" as const;
      if (classId) {
        const n = await tx.classGroup.updateMany({ where: { id: classId }, data: { name, sortOrder } });
        if (n.count === 0) return "missing" as const;
      } else {
        await tx.classGroup.create({ data: { schoolId: user.school.id, name, sortOrder } });
      }
      return "ok" as const;
    });
    if (result === "missing") return { error: "Class not found." };
    if (result === "dup") {
      const msg = "A class with this name already exists.";
      return { error: msg, fieldErrors: { name: [msg] }, values };
    }
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return { error: "A class with this name already exists.", values };
    }
    console.error("saveClass failed", error);
    return { error: "Something went wrong. Nothing was saved.", values };
  }
  refresh();
  return { ok: true, message: classId ? "Class saved." : `Class “${name}” added.` };
}

export async function setClassActive(_prev: FormState, formData: FormData): Promise<FormState> {
  const user = await requireSchoolAdmin();
  const classId = toId(formData.get("classId"));
  if (!classId) return { error: "Invalid request." };
  const isActive = formData.get("active") === "true";
  const n = await schoolDb(user, (tx) => tx.classGroup.updateMany({ where: { id: classId }, data: { isActive } }));
  if (n.count === 0) return { error: "Class not found." };
  refresh();
  return { ok: true };
}

/** Deletes an empty class. Classes with students must be emptied (or hidden) instead. */
export async function deleteClass(_prev: FormState, formData: FormData): Promise<FormState> {
  const user = await requireSchoolAdmin();
  const classId = toId(formData.get("classId"));
  if (!classId) return { error: "Invalid request." };
  const result = await schoolDb(user, async (tx) => {
    const c = await tx.classGroup.findUnique({ where: { id: classId }, include: { _count: { select: { students: true } } } });
    if (!c) return "missing" as const;
    if (c._count.students > 0) return "used" as const;
    await tx.classGroup.delete({ where: { id: classId } });
    await insertAudit(tx, {
      action: "class.delete",
      schoolId: user.school.id,
      actorUserId: user.id,
      entityType: "class",
      entityId: classId,
      details: { name: c.name },
    });
    return "ok" as const;
  });
  if (result === "missing") return { error: "Class not found." };
  if (result === "used") return { error: "This class still has students. Move them first, or hide the class instead." };
  refresh();
  return { ok: true };
}
