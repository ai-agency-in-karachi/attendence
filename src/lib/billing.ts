import type { BillingPeriod, SubscriptionStatus } from "@/generated/prisma/client";
import { addMonths } from "@/lib/dates";

/** How many months one billing period covers. */
export const PERIOD_MONTHS: Record<BillingPeriod, number> = { MONTHLY: 1, QUARTERLY: 3, YEARLY: 12 };

export const PERIOD_LABEL: Record<BillingPeriod, string> = {
  MONTHLY: "Monthly",
  QUARTERLY: "Quarterly",
  YEARLY: "Yearly",
};

/** End date (YYYY-MM-DD) of `periods` billing periods starting on `start`. */
export function periodEnd(start: string, period: BillingPeriod, periods = 1): string {
  return addMonths(start, PERIOD_MONTHS[period] * periods);
}

export type EffectiveStatus = SubscriptionStatus;

/**
 * A TRIAL/ACTIVE subscription whose end date has passed counts as EXPIRED,
 * even before anything has updated the stored status.
 */
export function effectiveStatus(sub: { status: SubscriptionStatus; endsAt: Date }, now = new Date()): EffectiveStatus {
  if ((sub.status === "ACTIVE" || sub.status === "TRIAL") && sub.endsAt <= now) return "EXPIRED";
  return sub.status;
}

export function isCurrent(sub: { status: SubscriptionStatus; endsAt: Date; startsAt: Date }, now = new Date()): boolean {
  const s = effectiveStatus(sub, now);
  return (s === "ACTIVE" || s === "TRIAL") && sub.startsAt <= now;
}

export function daysLeft(endsAt: Date, now = new Date()): number {
  return Math.ceil((endsAt.getTime() - now.getTime()) / 86_400_000);
}

/**
 * "2,500.50" / "2500" -> 250050 minor units. Returns null for anything that
 * isn't a plain non-negative amount with at most 2 decimals.
 */
export function parseMoneyToMinor(input: string): number | null {
  const s = input.trim().replace(/,/g, "");
  if (!/^\d{1,9}(\.\d{1,2})?$/.test(s)) return null;
  const [whole, frac = ""] = s.split(".");
  const minor = Number(whole) * 100 + Number(frac.padEnd(2, "0"));
  return Number.isSafeInteger(minor) && minor <= 2_000_000_000 ? minor : null;
}

/** 250050 -> "2500.50" (for form inputs). */
export function minorToInput(minor: number): string {
  return (minor / 100).toFixed(2);
}

export const CURRENCIES = ["PKR", "USD", "EUR", "GBP", "AED", "SAR", "INR", "BDT"] as const;

export const PAYMENT_METHOD_LABEL = {
  CASH: "Cash",
  BANK_TRANSFER: "Bank transfer",
  CHEQUE: "Cheque",
  ONLINE: "Online",
  OTHER: "Other",
} as const;
