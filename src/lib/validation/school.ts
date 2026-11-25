import { z } from "zod";
import { isValidTimeZone } from "@/lib/timezones";
import { SLUG_PATTERN } from "@/lib/slug";
import { PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH } from "@/lib/auth/password";

/** Empty form fields become `undefined` instead of "". */
const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max, `Must be at most ${max} characters.`)
    .transform((v) => (v === "" ? undefined : v))
    .optional();

export const createSchoolSchema = z
  .object({
    name: z.string().trim().min(2, "Enter the school name.").max(200, "Must be at most 200 characters."),
    slug: z
      .string()
      .trim()
      .toLowerCase()
      .min(2, "Enter a short web name (at least 2 characters).")
      .max(80, "Must be at most 80 characters.")
      .regex(SLUG_PATTERN, "Use only lowercase letters, numbers and single hyphens (e.g. green-valley)."),
    timezone: z.string().refine(isValidTimeZone, "Choose the school's time zone."),
    contactEmail: z
      .string()
      .trim()
      .toLowerCase()
      .transform((v) => (v === "" ? undefined : v))
      .pipe(z.email("Enter a valid email address.").max(254).optional()),
    contactPhone: optionalText(40),
    address: optionalText(500),

    // Optional first School Admin login
    createAdmin: z.boolean(),
    adminName: optionalText(200),
    adminEmail: z
      .string()
      .trim()
      .toLowerCase()
      .transform((v) => (v === "" ? undefined : v))
      .pipe(z.email("Enter a valid email address.").max(254).optional()),
    adminPassword: z.string().max(PASSWORD_MAX_LENGTH, `Must be at most ${PASSWORD_MAX_LENGTH} characters.`),
  })
  .superRefine((v, ctx) => {
    if (!v.createAdmin) return;
    if (!v.adminName) ctx.addIssue({ code: "custom", path: ["adminName"], message: "Enter the admin's name." });
    if (!v.adminEmail) ctx.addIssue({ code: "custom", path: ["adminEmail"], message: "Enter the admin's email." });
    if (v.adminPassword.length < PASSWORD_MIN_LENGTH) {
      ctx.addIssue({
        code: "custom",
        path: ["adminPassword"],
        message: `Password must be at least ${PASSWORD_MIN_LENGTH} characters.`,
      });
    }
  });

export type CreateSchoolInput = z.infer<typeof createSchoolSchema>;

/** Shared field rules for creating and editing a school's details. */
const schoolDetails = {
  name: z.string().trim().min(2, "Enter the school name.").max(200, "Must be at most 200 characters."),
  slug: z
    .string()
    .trim()
    .toLowerCase()
    .min(2, "Enter a short web name (at least 2 characters).")
    .max(80, "Must be at most 80 characters.")
    .regex(SLUG_PATTERN, "Use only lowercase letters, numbers and single hyphens (e.g. green-valley)."),
  timezone: z.string().refine(isValidTimeZone, "Choose the school's time zone."),
  contactEmail: z
    .string()
    .trim()
    .toLowerCase()
    .transform((v) => (v === "" ? undefined : v))
    .pipe(z.email("Enter a valid email address.").max(254).optional()),
  contactPhone: optionalText(40),
  address: optionalText(500),
};

export const updateSchoolSchema = z.object({
  ...schoolDetails,
  /** Custom storage quota in MB; empty = use the subscription plan's limit. */
  quotaOverrideMb: z
    .string()
    .trim()
    .transform((v) => (v === "" ? null : Number(v)))
    .pipe(
      z
        .number({ error: "Enter a number of MB, or leave empty." })
        .positive("Must be more than 0.")
        .max(10_000_000, "That is too large.")
        .nullable(),
    ),
});

export const newAdminSchema = z.object({
  fullName: z.string().trim().min(2, "Enter the admin's name.").max(200),
  email: z.string().trim().toLowerCase().pipe(z.email("Enter a valid email address.").max(254)),
  password: z
    .string()
    .min(PASSWORD_MIN_LENGTH, `Password must be at least ${PASSWORD_MIN_LENGTH} characters.`)
    .max(PASSWORD_MAX_LENGTH),
});

export const newPasswordSchema = z.object({
  password: z
    .string()
    .min(PASSWORD_MIN_LENGTH, `Password must be at least ${PASSWORD_MIN_LENGTH} characters.`)
    .max(PASSWORD_MAX_LENGTH),
});

export const changeOwnPasswordSchema = z
  .object({
    currentPassword: z.string().min(1, "Enter your current password.").max(PASSWORD_MAX_LENGTH),
    newPassword: z
      .string()
      .min(PASSWORD_MIN_LENGTH, `Password must be at least ${PASSWORD_MIN_LENGTH} characters.`)
      .max(PASSWORD_MAX_LENGTH),
    confirmPassword: z.string(),
  })
  .refine((v) => v.newPassword === v.confirmPassword, {
    path: ["confirmPassword"],
    message: "The two new passwords do not match.",
  })
  .refine((v) => v.newPassword !== v.currentPassword, {
    path: ["newPassword"],
    message: "Choose a password different from your current one.",
  });

export const MB = 1024 * 1024;
