import { test } from "node:test";
import assert from "node:assert/strict";
import { Client, Form, redirectsTo, makeSchool, makeSuperAdmin, sys, testPassword } from "./lib";

test("auth: sign-in, roles, revocation, lockout, password change", async (t) => {
  const sa = await makeSuperAdmin();
  const school = await makeSchool();

  await t.test("signed-out visitors are sent to /login", async () => {
    const c = new Client();
    for (const p of ["/super-admin", "/school", "/school/students", "/super-admin/plans"]) {
      const r = await c.get(p);
      assert.equal(r.status, 307, p);
      assert.match(r.location ?? "", /\/login$/);
    }
  });

  await t.test("wrong password and unknown email give the same message", async () => {
    const a = await new Client().login(school.admin.email, "wrong-password-123");
    const b = await new Client().login("nobody@e2e.example.test", "wrong-password-123");
    assert.match(a.text, /Invalid email or password\./);
    assert.match(b.text, /Invalid email or password\./);
    await sys((tx) => tx.user.update({ where: { email: school.admin.email }, data: { failedLoginCount: 0 } }));
  });

  await t.test("each role reaches only its own panel", async () => {
    const s = new Client();
    const r = await s.login(sa.email.toUpperCase(), sa.password);
    assert.equal(r.status, 303);
    assert.match(r.location ?? "", /\/super-admin$/);
    assert.match((await s.get("/super-admin")).text, /Dashboard/);
    assert.ok(redirectsTo(await s.get("/school"), "/super-admin"));

    const a = new Client();
    assert.match((await a.login(school.admin.email, school.admin.password)).location ?? "", /\/school$/);
    assert.match((await a.get("/school")).text, new RegExp(school.name));
    // A School Admin opening a Super Admin page is redirected and sees no platform data.
    const other = await makeSchool();
    const sa2 = await a.get("/super-admin/schools");
    assert.ok(redirectsTo(sa2, "/school"));
    assert.ok(!sa2.html.includes(other.name));
  });

  await t.test("deactivating the school logs its admin out on the next click", async () => {
    const a = new Client();
    await a.login(school.admin.email, school.admin.password);
    await sys((tx) => tx.school.update({ where: { id: school.id }, data: { status: "INACTIVE" } }));
    assert.doesNotMatch((await a.get("/school")).text, new RegExp(school.name));
    await sys((tx) => tx.school.update({ where: { id: school.id }, data: { status: "ACTIVE" } }));
  });

  await t.test("5 wrong passwords lock the account", async () => {
    const s2 = await makeSchool();
    for (let i = 0; i < 5; i++) await new Client().login(s2.admin.email, `wrong-${i}-password`);
    const r = await new Client().login(s2.admin.email, s2.admin.password);
    assert.match(r.text, /Too many failed attempts/);
  });

  await t.test("change own password: needs current password, signs out other devices", async () => {
    const s3 = await makeSchool();
    const phone = new Client();
    await phone.login(s3.admin.email, s3.admin.password);
    const laptop = new Client();
    await laptop.login(s3.admin.email, s3.admin.password);

    const newPw = testPassword();
    const bad = await laptop.action("/school/account", "changeOwnPassword", [
      undefined,
      new Form({ currentPassword: "not-my-password", newPassword: newPw, confirmPassword: newPw }),
    ]);
    assert.match(JSON.stringify(bad.result), /current password is not correct/);

    const mismatch = await laptop.action("/school/account", "changeOwnPassword", [
      undefined,
      new Form({ currentPassword: s3.admin.password, newPassword: newPw, confirmPassword: newPw + "x" }),
    ]);
    assert.match(JSON.stringify(mismatch.result), /do not match/);

    const ok = await laptop.action("/school/account", "changeOwnPassword", [
      undefined,
      new Form({ currentPassword: s3.admin.password, newPassword: newPw, confirmPassword: newPw }),
    ]);
    assert.match(JSON.stringify(ok.result), /Password changed/);
    assert.match((await laptop.get("/school")).text, new RegExp(s3.name), "this device stays signed in");
    assert.doesNotMatch((await phone.get("/school")).text, new RegExp(s3.name), "other device signed out");
    assert.match((await new Client().login(s3.admin.email, s3.admin.password)).text, /Invalid email or password/);
    assert.equal((await new Client().login(s3.admin.email, newPw)).status, 303);
  });
});
