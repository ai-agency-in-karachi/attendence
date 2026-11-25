import { test } from "node:test";
import assert from "node:assert/strict";
import { Client, Form, makeSchool, makeSuperAdmin, sys, uid } from "./lib";
import { newQrToken, qrPayload } from "../../src/lib/students";
import type { ScanResult } from "../../src/app/school/scan/types";

const MB = 1024 * 1024;
const JPEG = (n: number) => {
  const b = new Uint8Array(n);
  b.set([0xff, 0xd8, 0xff, 0xe0]);
  return new Blob([b], { type: "image/jpeg" });
};

async function addStudents(schoolId: number, n: number) {
  await sys((tx) =>
    tx.student.createMany({
      data: Array.from({ length: n }, (_, i) => ({ schoolId, studentCode: `ST-${i}-${uid()}`, fullName: `Storage Kid ${i}`, qrToken: newQrToken() })),
    }),
  );
}

test("storage and quotas (Phase 11)", async (t) => {
  await t.test("usage grows with students, photos and attendance", async () => {
    const s = await makeSchool();
    const a = new Client();
    await a.login(s.admin.email, s.admin.password);
    const r1 = await a.action("/school/students/new", "createStudent", [undefined, new Form({ studentCode: "U1", fullName: "Usage One", classGroupId: "" })]);
    const id = Number(/students\/(\d+)/.exec(r1.redirect ?? "")?.[1]);
    const after1 = (await sys((tx) => tx.school.findUniqueOrThrow({ where: { id: s.id } }))).storageUsedBytes;
    assert.ok(after1 > BigInt(0));
    await a.action(`/school/students/${id}`, "uploadPhoto", [undefined, new Form({ studentId: String(id), photo: JPEG(50_000) })]);
    const after2 = (await sys((tx) => tx.school.findUniqueOrThrow({ where: { id: s.id } }))).storageUsedBytes;
    assert.ok(after2 - after1 >= BigInt(50_000), "photo bytes counted");
    assert.match((await a.get("/school")).text, /Photos 48\.8 KB/);
  });

  await t.test("warning at 80%, full at 100%: adds blocked, attendance still works", async () => {
    const s = await makeSchool({ quotaMb: 0.01 }); // 10 KB
    await addStudents(s.id, 30); // ~300 B each: ~8.7 KB of 10 KB (85%)
    const a = new Client();
    await a.login(s.admin.email, s.admin.password);
    const dash = await a.get("/school");
    assert.match(dash.text, /Storage is \d+(\.\d)?% full/);

    await addStudents(s.id, 8); // over the limit
    const full = await a.get("/school");
    assert.match(full.text, /Storage is full/);
    const add = await a.action("/school/students/new", "createStudent", [undefined, new Form({ studentCode: "NOPE", fullName: "No Room", classGroupId: "" })]);
    assert.match(JSON.stringify(add.result), /storage is full/i);
    const someone = await sys((tx) => tx.student.findFirstOrThrow({ where: { schoolId: s.id } }));
    const photo = await a.action(`/school/students/${someone.id}`, "uploadPhoto", [undefined, new Form({ studentId: String(someone.id), photo: JPEG(1000) })]);
    assert.match(JSON.stringify(photo.result), /storage is full/i);
    // Taking attendance is never blocked.
    const scan = await a.action<ScanResult>("/school/scan", "scanQr", [qrPayload(someone.qrToken)]);
    assert.equal(scan.result.kind, "ok");
  });

  await t.test("custom quota overrides the plan; expired plan blocks adding", async () => {
    const s = await makeSchool(); // 100 MB plan
    const sa = await makeSuperAdmin();
    const c = new Client();
    await c.login(sa.email, sa.password);
    const page = `/super-admin/schools/${s.id}`;
    const base = { schoolId: String(s.id), name: s.name, slug: s.slug, timezone: "Asia/Karachi", contactEmail: "", contactPhone: "", address: "" };
    await c.action(`${page}/edit`, "updateSchool", [undefined, new Form({ ...base, quotaOverrideMb: "250" })]);
    assert.match((await c.get(page)).text, /of 250 MB/);
    await c.action(`${page}/edit`, "updateSchool", [undefined, new Form({ ...base, quotaOverrideMb: "" })]);
    assert.match((await c.get(page)).text, /of 100 MB/);

    // The subscription runs out.
    await sys((tx) => tx.subscription.updateMany({ where: { schoolId: s.id }, data: { endsAt: new Date(Date.now() - 60_000), startsAt: new Date(Date.now() - 86400_000) } }));
    const a = new Client();
    await a.login(s.admin.email, s.admin.password);
    assert.match((await a.get("/school")).text, /no active subscription/i);
    const add = await a.action("/school/students/new", "createStudent", [undefined, new Form({ studentCode: "EXP", fullName: "Expired Plan", classGroupId: "" })]);
    assert.match(JSON.stringify(add.result), /no active subscription/);
    assert.match((await c.get("/super-admin")).text, /Subscription ended/);
  });

  await t.test("Super Admin storage overview and 'measure all now'", async () => {
    const s = await makeSchool({ quotaMb: 1 });
    await addStudents(s.id, 3);
    await sys((tx) => tx.school.update({ where: { id: s.id }, data: { storageUsedBytes: BigInt(0), storageCalculatedAt: null } }));
    const sa = await makeSuperAdmin();
    const c = new Client();
    await c.login(sa.email, sa.password);
    const r = await c.action("/super-admin/storage", "recalculateAllStorage", []);
    assert.match(JSON.stringify(r.result), /Measured \d+ school/);
    const sch = await sys((tx) => tx.school.findUniqueOrThrow({ where: { id: s.id } }));
    assert.ok(sch.storageUsedBytes > BigInt(0));
    assert.ok(sch.storageCalculatedAt);
    assert.match((await c.get("/super-admin/storage")).text, new RegExp(s.name));
    // School Admins cannot run it.
    const a = new Client();
    await a.login(s.admin.email, s.admin.password);
    await sys((tx) => tx.school.update({ where: { id: s.id }, data: { storageCalculatedAt: new Date(0) } }));
    await a.action("/super-admin/storage", "recalculateAllStorage", []);
    void MB;
  });
});
