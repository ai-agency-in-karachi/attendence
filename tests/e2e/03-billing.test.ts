import { test } from "node:test";
import assert from "node:assert/strict";
import { Client, Form, PLAN_PREFIX, makeSchool, makeSuperAdmin, sys, uid } from "./lib";

const MB = 1024 * 1024;

test("billing: plans, subscriptions, payments (Phase 5)", async (t) => {
  const sa = await makeSuperAdmin();
  const c = new Client();
  await c.login(sa.email, sa.password);
  const school = await makeSchool({ plan: false });
  const page = `/super-admin/schools/${school.id}`;
  const planName = `${PLAN_PREFIX}Basic ${uid()}`;
  let planId = 0;

  await t.test("create a plan; validation and duplicate names", async () => {
    const base = { name: planName, description: "", storageLimitMb: "500", price: "2,500.50", currency: "pkr", billingPeriod: "MONTHLY" };
    const bad = await c.action("/super-admin/plans/new", "savePlan", [undefined, new Form({ ...base, storageLimitMb: "0", price: "abc" })]);
    assert.match(JSON.stringify(bad.result), /more than 0/);
    assert.match(JSON.stringify(bad.result), /Enter a price/);
    const ok = await c.action("/super-admin/plans/new", "savePlan", [undefined, new Form(base)]);
    assert.match(ok.redirect ?? "", /\/super-admin\/plans\?saved=1/);
    const plan = await sys((tx) => tx.plan.findUniqueOrThrow({ where: { name: planName } }));
    assert.equal(plan.priceMinor, 250050);
    assert.equal(plan.currency, "PKR");
    assert.equal(plan.storageLimitBytes, BigInt(500 * MB));
    planId = plan.id;
    const dup = await c.action("/super-admin/plans/new", "savePlan", [undefined, new Form({ ...base, name: planName.toUpperCase() })]);
    assert.match(JSON.stringify(dup.result), /already has this name/);
    assert.match((await c.get("/super-admin/plans")).text, new RegExp(planName));
  });

  await t.test("assign a plan: values are copied; a new plan replaces the old", async () => {
    const today = new Date().toISOString().slice(0, 10);
    const r = await c.action(page, "assignPlan", [undefined, new Form({ schoolId: String(school.id), planId: String(planId), status: "TRIAL", startsOn: today, endsOn: "", notes: "" })]);
    assert.match(JSON.stringify(r.result), /saved/);
    const subs = await sys((tx) => tx.subscription.findMany({ where: { schoolId: school.id } }));
    assert.equal(subs.length, 1);
    assert.equal(subs[0].status, "TRIAL");
    assert.equal(subs[0].priceMinor, 250050);

    // Editing the plan does not change the existing subscription.
    await c.action(`/super-admin/plans/${planId}`, "savePlan", [undefined, new Form({ planId: String(planId), name: planName, description: "", storageLimitMb: "1000", price: "9999", currency: "PKR", billingPeriod: "YEARLY" })]);
    const same = await sys((tx) => tx.subscription.findUniqueOrThrow({ where: { id: subs[0].id } }));
    assert.equal(same.priceMinor, 250050);
    assert.equal(same.storageLimitBytes, BigInt(500 * MB));

    await c.action(page, "assignPlan", [undefined, new Form({ schoolId: String(school.id), planId: String(planId), status: "ACTIVE", startsOn: today, endsOn: "", notes: "paid" })]);
    const after = await sys((tx) => tx.subscription.findMany({ where: { schoolId: school.id }, orderBy: { id: "asc" } }));
    assert.deepEqual(after.map((s) => s.status), ["CANCELLED", "ACTIVE"]);
    assert.equal(after[1].storageLimitBytes, BigInt(1000 * MB), "new subscription uses the edited plan");
    // Yearly plan: ends about 12 months later.
    const days = (after[1].endsAt.getTime() - after[1].startsAt.getTime()) / 86400000;
    assert.ok(days >= 364 && days <= 367, `yearly length ${days}`);

    const badDates = await c.action(page, "assignPlan", [undefined, new Form({ schoolId: String(school.id), planId: String(planId), status: "ACTIVE", startsOn: today, endsOn: "2000-01-01", notes: "" })]);
    assert.match(JSON.stringify(badDates.result), /after the start date/);
  });

  await t.test("record a payment and extend the subscription", async () => {
    const before = await sys((tx) => tx.subscription.findFirstOrThrow({ where: { schoolId: school.id, status: "ACTIVE" } }));
    const future = await c.action(page, "recordPayment", [undefined, new Form({ schoolId: String(school.id), amount: "100", currency: "PKR", method: "CASH", paidOn: "2999-01-01", reference: "", notes: "", extend: "" })]);
    assert.match(JSON.stringify(future.result), /cannot be in the future/);
    const zero = await c.action(page, "recordPayment", [undefined, new Form({ schoolId: String(school.id), amount: "0", currency: "PKR", method: "CASH", paidOn: "2026-01-01", reference: "", notes: "", extend: "" })]);
    assert.match(JSON.stringify(zero.result), /more than 0/);

    const ok = await c.action(page, "recordPayment", [undefined, new Form({ schoolId: String(school.id), amount: "9,999", currency: "PKR", method: "BANK_TRANSFER", paidOn: "2026-01-15", reference: "TX-1", notes: "", extend: "1" })]);
    assert.match(JSON.stringify(ok.result), /extended until/);
    const pay = await sys((tx) => tx.payment.findFirstOrThrow({ where: { schoolId: school.id } }));
    assert.equal(pay.amountMinor, 999900);
    assert.equal(pay.subscriptionId, before.id);
    const after = await sys((tx) => tx.subscription.findUniqueOrThrow({ where: { id: before.id } }));
    assert.ok(after.endsAt > before.endsAt);
    assert.match((await c.get(`/super-admin/payments?school=${school.id}`)).text, /TX-1/);
  });

  await t.test("end the subscription; overview pages render", async () => {
    const r = await c.action(page, "cancelSubscription", [undefined, new Form({ schoolId: String(school.id) })]);
    assert.match(JSON.stringify(r.result), /ended/);
    assert.equal(await sys((tx) => tx.subscription.count({ where: { schoolId: school.id, status: { in: ["ACTIVE", "TRIAL"] } } })), 0);
    for (const p of ["/super-admin/subscriptions?show=all", "/super-admin/storage", page]) {
      const res = await c.get(p);
      assert.equal(res.status, 200, p);
    }
    assert.match((await c.get(page)).text, /No current subscription/);
  });

  await t.test("School Admins cannot use billing actions", async () => {
    const a = new Client();
    await a.login(school.admin.email, school.admin.password);
    const n = await sys((tx) => tx.plan.count());
    await a.action("/super-admin/plans/new", "savePlan", [undefined, new Form({ name: `${PLAN_PREFIX}hack`, description: "", storageLimitMb: "1", price: "0", currency: "PKR", billingPeriod: "MONTHLY" })]);
    await a.action(page, "assignPlan", [undefined, new Form({ schoolId: String(school.id), planId: String(planId), status: "ACTIVE", startsOn: "2026-01-01", endsOn: "2099-01-01", notes: "" })]);
    await a.action(page, "recordPayment", [undefined, new Form({ schoolId: String(school.id), amount: "1", currency: "PKR", method: "CASH", paidOn: "2026-01-01", reference: "", notes: "", extend: "" })]);
    assert.equal(await sys((tx) => tx.plan.count()), n);
    assert.equal(await sys((tx) => tx.subscription.count({ where: { schoolId: school.id, status: "ACTIVE" } })), 0);
    assert.equal(await sys((tx) => tx.payment.count({ where: { schoolId: school.id } })), 1);
  });
});
