"use server";

import { redirect } from "next/navigation";
import { refresh } from "next/cache";
import { Prisma } from "@/generated/prisma/client";
import { requireSuperAdmin } from "@/lib/auth/dal";
import { platformDb, type Tx } from "@/lib/db";
import { insertAudit } from "@/lib/audit";
import { getClientIp } from "@/lib/auth/session";
import { invalid, readFields, toId, type FormState } from "@/lib/form";
import { assignPlanSchema, paymentSchema, planSchema } from "@/lib/validation/billing";
import { MB } from "@/lib/validation/school";
import { periodEnd } from "@/lib/billing";
import { dateOnlyToDb, dbToDateOnly, startOfDayInZone, todayInZone } from "@/lib/dates";

/*
 * Billing is managed only by the Super Admin. Every action re-checks the
 * role (requireSuperAdmin) and runs in the platform database scope.
 */

// ---------------------------------------------------------------------
//  Plans
// ---------------------------------------------------------------------

const PLAN_FIELDS = ["name", "description", "storageLimitMb", "price", "currency", "billingPeriod"] as const;

export async function savePlan(_prev: FormState, formData: FormData): Promise<FormState> {
  const user = await requireSuperAdmin();
  const planId = formData.get("planId") ? toId(formData.get("planId")) : null;
  if (formData.get("planId") && !planId) return { error: "Invalid request." };

  const values = readFields(formData, PLAN_FIELDS);
  const parsed = planSchema.safeParse(values);
  if (!parsed.success) return invalid(parsed.error, values);
  const p = parsed.data;
  const data = {
    name: p.name,
    description: p.description,
    storageLimitBytes: BigInt(p.storageLimitMb) * BigInt(MB),
    priceMinor: p.price,
    currency: p.currency,
    billingPeriod: p.billingPeriod,
  };
  const ip = await getClientIp();

  try {
    const result = await platformDb(user, async (tx) => {
      const clash = await tx.plan.findFirst({
        where: { name: { equals: p.name, mode: "insensitive" }, ...(planId && { id: { not: planId } }) },
        select: { id: true },
      });
      if (clash) return "name" as const;
      if (planId) {
        if (!(await tx.plan.findUnique({ where: { id: planId }, select: { id: true } }))) return "missing" as const;
        await tx.plan.update({ where: { id: planId }, data });
      }
      const plan = planId ? { id: planId } : await tx.plan.create({ data, select: { id: true } });
      await insertAudit(tx, {
        action: planId ? "plan.update" : "plan.create",
        actorUserId: user.id,
        entityType: "plan",
        entityId: plan.id,
        details: { name: p.name, storageLimitMb: p.storageLimitMb, priceMinor: p.price, currency: p.currency, period: p.billingPeriod },
        ipAddress: ip,
      });
      return "ok" as const;
    });
    if (result === "missing") return { error: "Plan not found." };
    if (result === "name") {
      const msg = "Another plan already has this name.";
      return { error: msg, fieldErrors: { name: [msg] }, values };
    }
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return { error: "Another plan already has this name.", values };
    }
    console.error("savePlan failed", error);
    return { error: "Something went wrong. Nothing was saved.", values };
  }
  redirect("/super-admin/plans?saved=1");
}

export async function setPlanActive(_prev: FormState, formData: FormData): Promise<FormState> {
  const user = await requireSuperAdmin();
  const planId = toId(formData.get("planId"));
  if (!planId) return { error: "Invalid request." };
  const active = formData.get("active") === "true";
  const ip = await getClientIp();
  const ok = await platformDb(user, async (tx) => {
    const n = await tx.plan.updateMany({ where: { id: planId }, data: { isActive: active } });
    if (n.count === 0) return false;
    await insertAudit(tx, {
      action: active ? "plan.activate" : "plan.deactivate",
      actorUserId: user.id,
      entityType: "plan",
      entityId: planId,
      ipAddress: ip,
    });
    return true;
  });
  if (!ok) return { error: "Plan not found." };
  refresh();
  return { ok: true };
}

// ---------------------------------------------------------------------
//  Subscriptions
// ---------------------------------------------------------------------

/** Closes the school's current subscription (if any) so a new one can start. */
async function closeCurrent(tx: Tx, schoolId: number, now: Date) {
  const open = await tx.subscription.findMany({
    where: { schoolId, status: { in: ["ACTIVE", "TRIAL"] } },
    select: { id: true, endsAt: true },
  });
  for (const s of open) {
    await tx.subscription.update({
      where: { id: s.id },
      data: { status: s.endsAt <= now ? "EXPIRED" : "CANCELLED" },
    });
  }
  return open.map((s) => s.id);
}

/** Puts a school on a plan (replaces its current subscription, if any). */
export async function assignPlan(_prev: FormState, formData: FormData): Promise<FormState> {
  const user = await requireSuperAdmin();
  const schoolId = toId(formData.get("schoolId"));
  if (!schoolId) return { error: "Invalid request." };
  const values = readFields(formData, ["planId", "status", "startsOn", "endsOn", "notes"] as const);
  const parsed = assignPlanSchema.safeParse(values);
  if (!parsed.success) return invalid(parsed.error, values);
  const input = parsed.data;
  const ip = await getClientIp();

  const result = await platformDb(user, async (tx) => {
    const [school, plan] = await Promise.all([
      tx.school.findUnique({ where: { id: schoolId }, select: { timezone: true } }),
      tx.plan.findUnique({ where: { id: input.planId } }),
    ]);
    if (!school) return { error: "School not found." };
    if (!plan || !plan.isActive) return { error: "Choose an active plan.", fieldErrors: { planId: ["Choose an active plan."] } };

    const endsOn = input.endsOn ?? periodEnd(input.startsOn, plan.billingPeriod);
    const startsAt = startOfDayInZone(input.startsOn, school.timezone);
    const endsAt = startOfDayInZone(endsOn, school.timezone);
    const now = new Date();
    if (endsAt <= now) return { error: "The end date is already in the past.", fieldErrors: { endsOn: ["Must be in the future."] } };

    const closed = await closeCurrent(tx, schoolId, now);
    // Price and storage limit are COPIED, so later plan edits don't change this customer.
    const sub = await tx.subscription.create({
      data: {
        schoolId,
        planId: plan.id,
        status: input.status,
        storageLimitBytes: plan.storageLimitBytes,
        priceMinor: plan.priceMinor,
        currency: plan.currency,
        startsAt,
        endsAt,
        notes: input.notes,
      },
    });
    await insertAudit(tx, {
      action: "subscription.create",
      actorUserId: user.id,
      schoolId,
      entityType: "subscription",
      entityId: sub.id,
      details: { plan: plan.name, status: input.status, startsOn: input.startsOn, endsOn, replaced: closed },
      ipAddress: ip,
    });
    return { ok: true, message: `Subscription to “${plan.name}” saved (until ${endsOn}).` };
  });
  if (result.ok) refresh();
  return { ...result, values: result.ok ? undefined : values };
}

export async function cancelSubscription(_prev: FormState, formData: FormData): Promise<FormState> {
  const user = await requireSuperAdmin();
  const schoolId = toId(formData.get("schoolId"));
  if (!schoolId) return { error: "Invalid request." };
  const ip = await getClientIp();
  const closed = await platformDb(user, async (tx) => {
    const ids = await closeCurrent(tx, schoolId, new Date());
    if (ids.length) {
      await insertAudit(tx, {
        action: "subscription.cancel",
        actorUserId: user.id,
        schoolId,
        entityType: "subscription",
        entityId: ids.join(","),
        ipAddress: ip,
      });
    }
    return ids.length;
  });
  if (!closed) return { error: "This school has no current subscription." };
  refresh();
  return { ok: true, message: "Subscription ended." };
}

/** Moves the current subscription's end date forward by one billing period. */
async function extendCurrent(tx: Tx, schoolId: number, timezone: string) {
  const sub = await tx.subscription.findFirst({
    where: { schoolId, status: { in: ["ACTIVE", "TRIAL"] } },
    include: { plan: { select: { billingPeriod: true } } },
  });
  if (!sub) return null;
  // Extend from the later of "today" and the current end date.
  const today = todayInZone(timezone);
  const currentEnd = todayInZone(timezone, sub.endsAt);
  const from = currentEnd > today ? currentEnd : today;
  const newEnd = periodEnd(from, sub.plan.billingPeriod);
  await tx.subscription.update({
    where: { id: sub.id },
    data: { endsAt: startOfDayInZone(newEnd, timezone), status: "ACTIVE" },
  });
  return { id: sub.id, newEnd };
}

export async function extendSubscription(_prev: FormState, formData: FormData): Promise<FormState> {
  const user = await requireSuperAdmin();
  const schoolId = toId(formData.get("schoolId"));
  if (!schoolId) return { error: "Invalid request." };
  const ip = await getClientIp();
  const result = await platformDb(user, async (tx) => {
    const school = await tx.school.findUnique({ where: { id: schoolId }, select: { timezone: true } });
    if (!school) return null;
    const ext = await extendCurrent(tx, schoolId, school.timezone);
    if (ext) {
      await insertAudit(tx, {
        action: "subscription.extend",
        actorUserId: user.id,
        schoolId,
        entityType: "subscription",
        entityId: ext.id,
        details: { newEnd: ext.newEnd },
        ipAddress: ip,
      });
    }
    return ext;
  });
  if (!result) return { error: "This school has no current subscription to extend." };
  refresh();
  return { ok: true, message: `Extended until ${result.newEnd}.` };
}

// ---------------------------------------------------------------------
//  Payments (recorded by hand: cash, bank transfer, cheque...)
// ---------------------------------------------------------------------

const PAYMENT_FIELDS = ["amount", "currency", "method", "paidOn", "reference", "notes", "extend"] as const;

export async function recordPayment(_prev: FormState, formData: FormData): Promise<FormState> {
  const user = await requireSuperAdmin();
  const schoolId = toId(formData.get("schoolId"));
  if (!schoolId) return { error: "Invalid request." };
  const values = readFields(formData, PAYMENT_FIELDS);
  const parsed = paymentSchema.safeParse(values);
  if (!parsed.success) return invalid(parsed.error, values);
  const p = parsed.data;
  const ip = await getClientIp();

  const result = await platformDb(user, async (tx) => {
    const school = await tx.school.findUnique({ where: { id: schoolId }, select: { timezone: true } });
    if (!school) return { error: "School not found." };
    if (p.paidOn > todayInZone(school.timezone)) {
      return { error: "The payment date cannot be in the future.", fieldErrors: { paidOn: ["Cannot be in the future."] } };
    }
    const current = await tx.subscription.findFirst({
      where: { schoolId, status: { in: ["ACTIVE", "TRIAL"] } },
      select: { id: true },
    });
    const payment = await tx.payment.create({
      data: {
        schoolId,
        subscriptionId: current?.id ?? null,
        amountMinor: p.amount,
        currency: p.currency,
        method: p.method,
        paidOn: dateOnlyToDb(p.paidOn),
        reference: p.reference,
        notes: p.notes,
        recordedById: user.id,
      },
    });
    const ext = p.extend ? await extendCurrent(tx, schoolId, school.timezone) : null;
    await insertAudit(tx, {
      action: "payment.record",
      actorUserId: user.id,
      schoolId,
      entityType: "payment",
      entityId: payment.id,
      details: { amountMinor: p.amount, currency: p.currency, method: p.method, paidOn: dbToDateOnly(payment.paidOn), extendedTo: ext?.newEnd ?? null },
      ipAddress: ip,
    });
    if (p.extend && !ext) return { ok: true, message: "Payment recorded. (No current subscription to extend.)" };
    return { ok: true, message: ext ? `Payment recorded. Subscription extended until ${ext.newEnd}.` : "Payment recorded." };
  });
  if (result.ok) refresh();
  return { ...result, values: result.ok ? undefined : values };
}
