import { z } from "zod";

/** Student ID / admission number: letters, digits and - / _ . (no spaces at the ends). */
export const STUDENT_CODE_PATTERN = /^[A-Za-z0-9][A-Za-z0-9\-/_. ]{0,48}[A-Za-z0-9]$|^[A-Za-z0-9]$/;

export const studentCode = z
  .string()
  .trim()
  .min(1, "Enter the student ID.")
  .max(50, "Must be at most 50 characters.")
  .regex(STUDENT_CODE_PATTERN, "Use letters, numbers and - / _ . only.");

export const studentName = z
  .string()
  .trim()
  .transform((v) => v.replace(/\s+/g, " "))
  .pipe(z.string().min(2, "Enter the student's full name.").max(200, "Must be at most 200 characters."));

export const studentSchema = z.object({
  studentCode,
  fullName: studentName,
  classGroupId: z
    .string()
    .trim()
    .refine((v) => v === "" || /^\d{1,9}$/.test(v), "Choose a class.")
    .transform((v) => (v === "" ? null : Number(v))),
});

export const className = z
  .string()
  .trim()
  .transform((v) => v.replace(/\s+/g, " "))
  .pipe(z.string().min(1, "Enter a class name.").max(100, "Must be at most 100 characters."));

export const classSchema = z.object({
  name: className,
  sortOrder: z
    .string()
    .trim()
    .transform((v) => (v === "" ? 0 : Number(v)))
    .pipe(z.number({ error: "Enter a number." }).int("Use a whole number.").min(-9999).max(9999)),
});
