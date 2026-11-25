import { z } from "zod";
import { isDateOnly } from "@/lib/dates";
import { parseMoneyToMinor } from "@/lib/billing";

const money = (label: string, allowZero: boolean) =>
  z
    .string()
    .transform((v, ctx) => {
      const minor = parseMoneyToMinor(v);
      if (minor === null || (!allowZero && minor === 0)) {
        ctx.addIssue({ code: "custom", message: `Enter ${label} like 2500 or 2500.50${allowZero ? "" : " (more than 0)"}.` });
        return z.NEVER;
      }
      return minor;
    });

const currency = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z]{3}$/, "Use a 3-letter currency code, e.g. PKR.");

const dateOnly = (msg: string) => z.string().trim().refine(isDateOnly, msg);

const optionalNotes = z
  .string()
  .trim()
  .max(1000, "Must be at most 1000 characters.")
  .transform((v) => (v === "" ? null : v));

export const planSchema = z.object({
  name: z.string().trim().min(2, "Enter a plan name.").max(100, "Must be at most 100 characters."),
  description: optionalNotes,
  storageLimitMb: z
    .string()
    .trim()
    .transform((v) => Number(v))
    .pipe(z.number({ error: "Enter the storage limit in MB." }).int("Use a whole number of MB.").positive("Must be more than 0.").max(10_000_000, "That is too large.")),
  price: money("a price", true),
  currency,
  billingPeriod: z.enum(["MONTHLY", "QUARTERLY", "YEARLY"], { error: "Choose a billing period." }),
});

export const assignPlanSchema = z
  .object({
    planId: z.string().regex(/^\d{1,9}$/, "Choose a plan.").transform(Number),
    status: z.enum(["ACTIVE", "TRIAL"], { error: "Choose a status." }),
    startsOn: dateOnly("Enter a valid start date."),
    /** Empty = one billing period after the start date. */
    endsOn: z
      .string()
      .trim()
      .refine((v) => v === "" || isDateOnly(v), "Enter a valid end date, or leave empty.")
      .transform((v) => (v === "" ? null : v)),
    notes: optionalNotes,
  })
  .refine((v) => v.endsOn === null || v.endsOn > v.startsOn, { path: ["endsOn"], message: "End date must be after the start date." });

export const paymentSchema = z.object({
  amount: money("the amount", false),
  currency,
  method: z.enum(["CASH", "BANK_TRANSFER", "CHEQUE", "ONLINE", "OTHER"], { error: "Choose how it was paid." }),
  paidOn: dateOnly("Enter the date it was paid."),
  reference: z
    .string()
    .trim()
    .max(200, "Must be at most 200 characters.")
    .transform((v) => (v === "" ? null : v)),
  notes: optionalNotes,
  /** "1" = also extend the current subscription by one billing period. */
  extend: z.string().transform((v) => v === "1" || v === "on"),
});
