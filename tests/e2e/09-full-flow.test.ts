import { test } from "node:test";
import assert from "node:assert/strict";
import { Client, Form, PLAN_PREFIX, SLUG_PREFIX, makeSuperAdmin, sys, testEmail, testPassword, uid } from "./lib";
import { qrPayload } from "../../src/lib/students";
import { todayInZone } from "../../src/lib/dates";
import type { ScanResult } from "../../src/app/school/scan/types";
import type { ImportReport } from "../../src/lib/import-types";

test("full flow: new school -> plan -> import -> cards -> scan -> register", async () => {
  // 1. Super Admin creates a school with its first admin, a plan and a subscription.
  const sa = await makeSuperAdmin();
  const boss = new Client();
  await boss.login(sa.email, sa.password);
  const slug = `${SLUG_PREFIX}${uid()}`;
  const adminEmail = testEmail("flow");
  const adminPassword = testPassword();
  const created = await boss.submitForm("/super-admin/schools/new", {
    name: "Flow Test School", slug, timezone: "Asia/Karachi", contactEmail: "", contactPhone: "", address: "",
    createAdmin: "on", adminName: "Flow Admin", adminEmail, adminPassword,
  });
  assert.equal(created.status, 303);
  const school = await sys((tx) => tx.school.findUniqueOrThrow({ where: { slug } }));
  const planName = `${PLAN_PREFIX}Flow ${uid()}`;
  await boss.action("/super-admin/plans/new", "savePlan", [undefined, new Form({ name: planName, description: "", storageLimitMb: "50", price: "1500", currency: "PKR", billingPeriod: "MONTHLY" })]);
  const plan = await sys((tx) => tx.plan.findUniqueOrThrow({ where: { name: planName } }));
  const sub = await boss.action(`/super-admin/schools/${school.id}`, "assignPlan", [undefined, new Form({ schoolId: String(school.id), planId: String(plan.id), status: "ACTIVE", startsOn: todayInZone("Asia/Karachi"), endsOn: "", notes: "" })]);
  assert.match(JSON.stringify(sub.result), /saved/);
  await boss.action(`/super-admin/schools/${school.id}`, "recordPayment", [undefined, new Form({ schoolId: String(school.id), amount: "1500", currency: "PKR", method: "CASH", paidOn: todayInZone("Asia/Karachi"), reference: "R-1", notes: "", extend: "" })]);

  // 2. The School Admin signs in and imports students from a CSV file.
  const admin = new Client();
  assert.equal((await admin.login(adminEmail, adminPassword)).status, 303);
  const csv = "Student ID,Full Name,Class\r\n2001,Hina Malik,Grade 3\r\n2002,Omar Farooq,Grade 3\r\n2003,Zara Sheikh,Grade 4\r\n";
  const file = new File([csv], "class-list.csv", { type: "text/csv" });
  const preview = await admin.action<{ data: ImportReport }>("/school/import", "importStudents", [undefined, new Form({ file, intent: "preview", mode: "skip", createClasses: "on", lastModified: "1" })]);
  assert.equal(preview.result.data.create, 3);
  const done = await admin.action<{ data: ImportReport }>("/school/import", "importStudents", [undefined, new Form({ file, intent: "commit", mode: "skip", createClasses: "on", lastModified: "1" })]);
  assert.equal(done.result.data.stage, "done");

  // 3. Cards can be printed for the class.
  const cards = await admin.get("/school/cards");
  assert.match(cards.text, /Hina Malik/);
  assert.equal((cards.html.match(/<svg/g) ?? []).length >= 3, true);

  // 4. Attendance is taken by scanning a card.
  const hina = await sys((tx) => tx.student.findFirstOrThrow({ where: { schoolId: school.id, studentCode: "2001" } }));
  const r = await admin.action<ScanResult>("/school/scan", "scanQr", [qrPayload(hina.qrToken)]);
  assert.equal(r.result.kind, "ok");
  assert.equal((await admin.action<ScanResult>("/school/scan", "scanQr", [qrPayload(hina.qrToken)])).result.kind, "duplicate");

  // 5. The register, dashboard and CSV export show it.
  assert.match((await admin.get("/school")).text, /Present today 1/);
  const csvOut = await admin.get("/school/attendance/export");
  const line = csvOut.html.split("\r\n").find((l) => l.includes("Hina Malik"))!;
  assert.match(line, /,P,/);
  assert.match(line, /,1,0,100$/);

  // 6. The Super Admin sees the school's students and storage use.
  const detail = await boss.get(`/super-admin/schools/${school.id}`);
  assert.match(detail.text, /Students 3/);
  assert.match(detail.text, /of 50 MB/);
});
