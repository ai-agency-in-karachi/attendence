import { test } from "node:test";
import assert from "node:assert/strict";
import { Client, Form, makeSchool, sys, uid } from "./lib";

const JPEG = new Blob([new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 16, 0x4a, 0x46, 0x49, 0x46, 0, 1, 1, 0, 0, 1, 0, 1, 0, 0, 0xff, 0xd9])], { type: "image/jpeg" });

test("students and classes (Phase 6)", async (t) => {
  const school = await makeSchool();
  const other = await makeSchool();
  const a = new Client();
  await a.login(school.admin.email, school.admin.password);
  const b = new Client();
  await b.login(other.admin.email, other.admin.password);

  let classId = 0;
  let studentId = 0;
  const code = `S-${uid()}`;

  await t.test("classes: add, duplicate (any case), rename", async () => {
    const r = await a.action("/school/classes", "saveClass", [undefined, new Form({ name: "Grade 5 - A", sortOrder: "5" })]);
    assert.match(JSON.stringify(r.result), /added/);
    const dup = await a.action("/school/classes", "saveClass", [undefined, new Form({ name: "grade 5 - a", sortOrder: "" })]);
    assert.match(JSON.stringify(dup.result), /already exists/);
    classId = (await sys((tx) => tx.classGroup.findFirstOrThrow({ where: { schoolId: school.id } }))).id;
    await a.action("/school/classes", "saveClass", [undefined, new Form({ classId: String(classId), name: "Grade 5 A", sortOrder: "1" })]);
    assert.equal((await sys((tx) => tx.classGroup.findUniqueOrThrow({ where: { id: classId } }))).name, "Grade 5 A");
    // The same name is fine in another school.
    const r2 = await b.action("/school/classes", "saveClass", [undefined, new Form({ name: "Grade 5 A", sortOrder: "" })]);
    assert.match(JSON.stringify(r2.result), /added/);
  });

  await t.test("add student: validation, success, duplicate ID", async () => {
    const bad = await a.action("/school/students/new", "createStudent", [undefined, new Form({ studentCode: "", fullName: "x", classGroupId: "" })]);
    assert.match(JSON.stringify(bad.result), /Enter the student ID/);
    const ok = await a.action("/school/students/new", "createStudent", [undefined, new Form({ studentCode: code, fullName: "  Ali   Raza ", classGroupId: String(classId) })]);
    assert.match(ok.redirect ?? "", /\/school\/students\/\d+\?created=1/);
    const s = await sys((tx) => tx.student.findFirstOrThrow({ where: { schoolId: school.id, studentCode: code } }));
    studentId = s.id;
    assert.equal(s.fullName, "Ali Raza");
    assert.ok(s.qrToken.length >= 32);
    const dup = await a.action("/school/students/new", "createStudent", [undefined, new Form({ studentCode: code.toLowerCase(), fullName: "Other", classGroupId: "" })]);
    assert.match(JSON.stringify(dup.result), /already used by Ali Raza/);
    // Same code in another school is allowed.
    const okB = await b.action("/school/students/new", "createStudent", [undefined, new Form({ studentCode: code, fullName: "Other School Kid", classGroupId: "" })]);
    assert.match(okB.redirect ?? "", /created=1/);
  });

  await t.test("list, search and detail pages", async () => {
    const list = await a.get(`/school/students?q=${encodeURIComponent("ali r")}`);
    assert.match(list.text, /Ali Raza/);
    assert.doesNotMatch(list.text, /Other School Kid/);
    assert.match((await a.get(`/school/students/${studentId}`)).text, /Ali Raza/);
    assert.match((await a.get("/school")).text, /Active students/);
    assert.match((await a.get("/school/classes")).text, /Grade 5 A/);
  });

  await t.test("edit, deactivate, reactivate, new QR code", async () => {
    const r = await a.action(`/school/students/${studentId}`, "updateStudent", [undefined, new Form({ studentId: String(studentId), studentCode: code, fullName: "Ali Raza Khan", classGroupId: "" })]);
    assert.match(JSON.stringify(r.result), /Changes saved/);
    const before = await sys((tx) => tx.student.findUniqueOrThrow({ where: { id: studentId } }));
    assert.equal(before.classGroupId, null);
    await a.action(`/school/students/${studentId}`, "setStudentStatus", [undefined, new Form({ studentId: String(studentId), status: "INACTIVE" })]);
    assert.equal((await sys((tx) => tx.student.findUniqueOrThrow({ where: { id: studentId } }))).status, "INACTIVE");
    await a.action(`/school/students/${studentId}`, "setStudentStatus", [undefined, new Form({ studentId: String(studentId), status: "ACTIVE" })]);
    await a.action(`/school/students/${studentId}`, "regenerateQr", [undefined, new Form({ studentId: String(studentId) })]);
    const after = await sys((tx) => tx.student.findUniqueOrThrow({ where: { id: studentId } }));
    assert.equal(after.status, "ACTIVE");
    assert.notEqual(after.qrToken, before.qrToken);
  });

  await t.test("photo: upload, serve, reject non-images, counted in storage", async () => {
    const bad = await a.action(`/school/students/${studentId}`, "uploadPhoto", [undefined, new Form({ studentId: String(studentId), photo: new Blob(["<svg/>"], { type: "image/jpeg" }) })]);
    assert.match(JSON.stringify(bad.result), /JPG, PNG or WebP/);
    const ok = await a.action(`/school/students/${studentId}`, "uploadPhoto", [undefined, new Form({ studentId: String(studentId), photo: JPEG })]);
    assert.match(JSON.stringify(ok.result), /Photo saved/);
    const s = await sys((tx) => tx.student.findUniqueOrThrow({ where: { id: studentId } }));
    assert.equal(s.photoBytes, JPEG.size);
    const img = await a.get(`/school/students/${studentId}/photo`);
    assert.equal(img.status, 200);
    assert.equal(img.headers.get("content-type"), "image/jpeg");
    const sch = await sys((tx) => tx.school.findUniqueOrThrow({ where: { id: school.id } }));
    assert.ok(sch.storageUsedBytes > BigInt(0), "usage saved after upload");
  });

  await t.test("another school cannot see or change this student", async () => {
    assert.equal((await b.get(`/school/students/${studentId}/photo`)).status, 404);
    const page = await b.get(`/school/students/${studentId}`);
    assert.doesNotMatch(page.text, /Ali Raza/);
    const upd = await b.action(`/school/students/${studentId}`, "updateStudent", [undefined, new Form({ studentId: String(studentId), studentCode: "HACK", fullName: "Hacked", classGroupId: "" })]);
    assert.match(JSON.stringify(upd.result), /not found/);
    for (const name of ["setStudentStatus", "regenerateQr", "removePhoto", "deleteStudent"]) {
      await b.action(`/school/students/${studentId}`, name, [undefined, new Form({ studentId: String(studentId), status: "INACTIVE" })]);
    }
    // A class id from school A cannot be used by school B.
    const cls = await b.action("/school/students/new", "createStudent", [undefined, new Form({ studentCode: `X-${uid()}`, fullName: "Sneaky", classGroupId: String(classId) })]);
    assert.match(JSON.stringify(cls.result), /Choose a class from the list/);
    const s = await sys((tx) => tx.student.findUniqueOrThrow({ where: { id: studentId } }));
    assert.equal(s.fullName, "Ali Raza Khan");
    assert.equal(s.status, "ACTIVE");
    assert.ok(s.photoKey);
  });

  await t.test("delete: only without attendance history", async () => {
    await sys((tx) => tx.attendance.create({ data: { studentId, schoolId: school.id, date: new Date("2026-01-05"), status: "PRESENT", source: "MANUAL" } }));
    const refused = await a.action(`/school/students/${studentId}`, "deleteStudent", [undefined, new Form({ studentId: String(studentId) })]);
    assert.match(JSON.stringify(refused.result), /Deactivate them instead/);
    const temp = await a.action("/school/students/new", "createStudent", [undefined, new Form({ studentCode: `T-${uid()}`, fullName: "Temp Kid", classGroupId: "" })]);
    const tempId = Number(/students\/(\d+)/.exec(temp.redirect ?? "")?.[1]);
    await a.action(`/school/students/${tempId}`, "uploadPhoto", [undefined, new Form({ studentId: String(tempId), photo: JPEG })]);
    const del = await a.action(`/school/students/${tempId}`, "deleteStudent", [undefined, new Form({ studentId: String(tempId) })]);
    assert.match(del.redirect ?? "", /deleted=1/);
    assert.equal(await sys((tx) => tx.student.count({ where: { id: tempId } })), 0);
  });

  await t.test("storage quota and missing plan block new students", async () => {
    const tiny = await makeSchool({ quotaMb: 0.0001 }); // ~100 bytes
    const c = new Client();
    await c.login(tiny.admin.email, tiny.admin.password);
    const r = await c.action("/school/students/new", "createStudent", [undefined, new Form({ studentCode: "A1", fullName: "Full Quota", classGroupId: "" })]);
    assert.match(JSON.stringify(r.result), /Not enough storage|storage is full/i);
    assert.match((await c.get("/school")).text, /of 105 B/);

    const noPlan = await makeSchool({ plan: false });
    const d = new Client();
    await d.login(noPlan.admin.email, noPlan.admin.password);
    const r2 = await d.action("/school/students/new", "createStudent", [undefined, new Form({ studentCode: "A1", fullName: "No Plan", classGroupId: "" })]);
    assert.match(JSON.stringify(r2.result), /no active subscription/);
  });
});
