import { test } from "node:test";
import assert from "node:assert/strict";
import { Client, Form, SLUG_PREFIX, makeSchool, makeSuperAdmin, sys, testEmail, testPassword, uid } from "./lib";

test("schools: create, edit, admins (Phase 4 + 4b)", async (t) => {
  const sa = await makeSuperAdmin();
  const c = new Client();
  await c.login(sa.email, sa.password);

  await t.test("create school with first admin (no-JS form)", async () => {
    const slug = `${SLUG_PREFIX}${uid()}`;
    const r = await c.submitForm("/super-admin/schools/new", {
      name: "E2E Created School",
      slug,
      timezone: "Asia/Karachi",
      contactEmail: "",
      contactPhone: "",
      address: "",
      createAdmin: "on",
      adminName: "First Admin",
      adminEmail: testEmail("first"),
      adminPassword: testPassword(),
    });
    assert.equal(r.status, 303);
    const s = await sys((tx) => tx.school.findUnique({ where: { slug }, include: { users: true } }));
    assert.ok(s);
    assert.equal(s.users.length, 1);
  });

  const school = await makeSchool();
  const page = `/super-admin/schools/${school.id}`;

  await t.test("edit school details, web name clash, quota override", async () => {
    const other = await makeSchool();
    const base = {
      schoolId: String(school.id),
      name: "E2E Renamed School",
      slug: school.slug,
      timezone: "Europe/London",
      contactEmail: "Office@E2E.example.test",
      contactPhone: "123",
      address: "Somewhere",
      quotaOverrideMb: "250",
    };
    const clash = await c.action(`${page}/edit`, "updateSchool", [undefined, new Form({ ...base, slug: other.slug })]);
    assert.match(JSON.stringify(clash.result), /already used by another school/);

    const badQuota = await c.action(`${page}/edit`, "updateSchool", [undefined, new Form({ ...base, quotaOverrideMb: "-5" })]);
    assert.match(JSON.stringify(badQuota.result), /more than 0/);

    const ok = await c.action(`${page}/edit`, "updateSchool", [undefined, new Form(base)]);
    assert.match(ok.redirect ?? "", new RegExp(`/super-admin/schools/${school.id}\\?saved=1`));
    const s = await sys((tx) => tx.school.findUniqueOrThrow({ where: { id: school.id } }));
    assert.equal(s.name, "E2E Renamed School");
    assert.equal(s.timezone, "Europe/London");
    assert.equal(s.contactEmail, "office@e2e.example.test");
    assert.equal(s.storageQuotaOverrideBytes, BigInt(250 * 1024 * 1024));
    const audit = await sys((tx) => tx.auditLog.findFirst({ where: { schoolId: school.id, action: "school.update" } }));
    assert.ok(audit, "edit is audited");

    // Clearing the quota field removes the override.
    await c.action(`${page}/edit`, "updateSchool", [undefined, new Form({ ...base, quotaOverrideMb: "" })]);
    const s2 = await sys((tx) => tx.school.findUniqueOrThrow({ where: { id: school.id } }));
    assert.equal(s2.storageQuotaOverrideBytes, null);

    const pageText = (await c.get(page)).text;
    assert.match(pageText, /Edit details/);
  });

  await t.test("add a second admin; duplicates and weak passwords rejected", async () => {
    const email = testEmail("second");
    const pw = testPassword();
    const weak = await c.action(page, "addSchoolAdmin", [undefined, new Form({ schoolId: String(school.id), fullName: "Second", email, password: "short" })]);
    assert.match(JSON.stringify(weak.result), /at least 10 characters/);
    const ok = await c.action(page, "addSchoolAdmin", [undefined, new Form({ schoolId: String(school.id), fullName: "Second", email, password: pw })]);
    assert.match(JSON.stringify(ok.result), /added/);
    const dup = await c.action(page, "addSchoolAdmin", [undefined, new Form({ schoolId: String(school.id), fullName: "Dup", email, password: pw })]);
    assert.match(JSON.stringify(dup.result), /already exists/);
    assert.equal((await new Client().login(email, pw)).status, 303, "new admin can sign in");
  });

  await t.test("reset an admin's password signs them out everywhere", async () => {
    const admin = new Client();
    await admin.login(school.admin.email, school.admin.password);
    const u = await sys((tx) => tx.user.findUniqueOrThrow({ where: { email: school.admin.email } }));
    const newPw = testPassword();
    const r = await c.action(page, "resetAdminPassword", [undefined, new Form({ userId: String(u.id), password: newPw })]);
    assert.match(JSON.stringify(r.result), /New password set/);
    assert.doesNotMatch((await admin.get("/school")).text, /E2E Renamed School/, "old session ended");
    assert.match((await new Client().login(school.admin.email, school.admin.password)).text, /Invalid email or password/);
    assert.equal((await new Client().login(school.admin.email, newPw)).status, 303);
    school.admin.password = newPw;
  });

  await t.test("disable / enable an admin", async () => {
    const u = await sys((tx) => tx.user.findUniqueOrThrow({ where: { email: school.admin.email } }));
    await c.action(page, "setAdminActive", [undefined, new Form({ userId: String(u.id), active: "false" })]);
    assert.match((await new Client().login(school.admin.email, school.admin.password)).text, /currently disabled/);
    await c.action(page, "setAdminActive", [undefined, new Form({ userId: String(u.id), active: "true" })]);
    assert.equal((await new Client().login(school.admin.email, school.admin.password)).status, 303);
  });

  await t.test("School Admins cannot use any of these actions", async () => {
    const a = new Client();
    await a.login(school.admin.email, school.admin.password);
    const target = await makeSchool();
    const before = await sys((tx) => tx.school.findUniqueOrThrow({ where: { id: target.id } }));
    await a.action(page, "updateSchool", [undefined, new Form({ schoolId: String(target.id), name: "Hacked", slug: target.slug, timezone: "UTC", contactEmail: "", contactPhone: "", address: "", quotaOverrideMb: "" })]);
    const email = testEmail("hacker");
    await a.action(page, "addSchoolAdmin", [undefined, new Form({ schoolId: String(target.id), fullName: "H", email, password: testPassword() })]);
    const victim = await sys((tx) => tx.user.findUniqueOrThrow({ where: { email: target.admin.email } }));
    await a.action(page, "resetAdminPassword", [undefined, new Form({ userId: String(victim.id), password: "HackedPassword1" })]);
    const after = await sys((tx) => tx.school.findUniqueOrThrow({ where: { id: target.id } }));
    assert.equal(after.name, before.name);
    assert.equal(await sys((tx) => tx.user.count({ where: { email } })), 0);
    assert.equal((await new Client().login(target.admin.email, target.admin.password)).status, 303, "victim password unchanged");
  });
});
