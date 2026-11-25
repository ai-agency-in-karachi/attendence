import { test } from "node:test";
import assert from "node:assert/strict";
import { Client, Form, makeSchool, makeSuperAdmin, sys, uid } from "./lib";
import { newQrToken } from "../../src/lib/students";
import { addDays, todayInZone } from "../../src/lib/dates";

const TZ = "Asia/Karachi";
const day = (d: string) => new Date(`${d}T00:00:00Z`);

test("attendance register (Phase 10)", async (t) => {
  const school = await makeSchool({ timezone: TZ });
  const a = new Client();
  await a.login(school.admin.email, school.admin.password);
  const today = todayInZone(TZ);
  const month = today.slice(0, 7);

  const { classA, classB, ali, sara, bilal, gone } = await sys(async (tx) => {
    const classA = await tx.classGroup.create({ data: { schoolId: school.id, name: `A-${uid()}` } });
    const classB = await tx.classGroup.create({ data: { schoolId: school.id, name: `B-${uid()}` } });
    const mk = (fullName: string, classGroupId: number, status: "ACTIVE" | "INACTIVE" = "ACTIVE") =>
      tx.student.create({ data: { schoolId: school.id, studentCode: `R-${uid()}`, fullName, classGroupId, status, qrToken: newQrToken() } });
    return {
      classA,
      classB,
      ali: await mk("Ali Register", classA.id),
      sara: await mk("=HYPERLINK(evil)", classA.id),
      bilal: await mk("Bilal Register", classB.id),
      gone: await mk("Gone Register", classA.id, "INACTIVE"),
    };
  });
  await sys((tx) =>
    tx.attendance.createMany({
      data: [
        { studentId: ali.id, schoolId: school.id, date: day(today), status: "PRESENT", source: "QR_SCAN" },
        { studentId: bilal.id, schoolId: school.id, date: day(today), status: "ABSENT", source: "MANUAL" },
      ],
    }),
  );

  await t.test("grid shows active students with marks, month and filters", async () => {
    const all = await a.get("/school/attendance");
    assert.match(all.text, /Ali Register/);
    assert.match(all.text, /Bilal Register/);
    assert.doesNotMatch(all.text, /Gone Register/, "inactive hidden by default");
    assert.match(all.text, /Present per day/);
    const onlyA = await a.get(`/school/attendance?class=${classA.id}`);
    assert.match(onlyA.text, /Ali Register/);
    assert.doesNotMatch(onlyA.text, /Bilal Register/);
    assert.match((await a.get(`/school/attendance?class=${classA.id}&inactive=1`)).text, /Gone Register/);
    assert.match((await a.get("/school/attendance?q=bilal")).text, /Bilal Register/);
    assert.match((await a.get("/school/attendance?month=2026-01")).text, /January 2026/);
  });

  await t.test("manual edits: present, absent, clear; audited; no future days", async () => {
    const set = (status: string | null, d = today, id = sara.id) => a.action<{ ok: boolean; error?: string }>("/school/attendance", "setAttendance", [id, d, status]);
    assert.equal((await set("PRESENT")).result.ok, true);
    let row = await sys((tx) => tx.attendance.findUnique({ where: { studentId_date: { studentId: sara.id, date: day(today) } } }));
    assert.equal(row?.status, "PRESENT");
    assert.equal(row?.source, "MANUAL");
    await set("ABSENT");
    row = await sys((tx) => tx.attendance.findUnique({ where: { studentId_date: { studentId: sara.id, date: day(today) } } }));
    assert.equal(row?.status, "ABSENT");
    await set(null);
    assert.equal(await sys((tx) => tx.attendance.count({ where: { studentId: sara.id } })), 0);
    assert.equal(await sys((tx) => tx.auditLog.count({ where: { schoolId: school.id, action: "attendance.update" } })), 3);

    const future = await set("PRESENT", addDays(today, 1));
    assert.equal(future.result.ok, false);
    assert.match(future.result.error ?? "", /future/);
    const bad = await set("MAYBE");
    assert.equal(bad.result.ok, false);
  });

  await t.test("mark unscanned students absent (keeps existing marks)", async () => {
    const r = await a.action(`/school/attendance`, "markRestAbsent", [undefined, new Form({ date: today, classId: String(classA.id) })]);
    assert.match(JSON.stringify(r.result), /1 student marked absent/, "only Sara (class A, active, no mark)");
    const marks = await sys((tx) => tx.attendance.findMany({ where: { schoolId: school.id, date: day(today) }, select: { studentId: true, status: true } }));
    const m = Object.fromEntries(marks.map((x) => [x.studentId, x.status]));
    assert.equal(m[ali.id], "PRESENT", "scan kept");
    assert.equal(m[sara.id], "ABSENT");
    assert.equal(m[bilal.id], "ABSENT");
    assert.equal(m[gone.id], undefined, "inactive students untouched");
    const again = await a.action(`/school/attendance`, "markRestAbsent", [undefined, new Form({ date: today })]);
    assert.match(JSON.stringify(again.result), /already has a mark/);
    void classB;
  });

  await t.test("CSV export matches the grid and is safe to open in Excel", async () => {
    const r = await a.get(`/school/attendance/export?month=${month}`);
    assert.equal(r.status, 200);
    assert.match(r.headers.get("content-disposition") ?? "", /attendance-.*\.csv/);
    const lines = r.html.replace(/^﻿/, "").trim().split("\r\n");
    assert.ok(lines[0].startsWith("Student ID,Full Name,Class,Status,"));
    assert.ok(lines[0].includes(today));
    const aliLine = lines.find((l) => l.includes("Ali Register"))!;
    assert.ok(aliLine.includes(",P,") || aliLine.includes(",P\r") || /,P,/.test(aliLine));
    const saraLine = lines.find((l) => l.includes("HYPERLINK"))!;
    assert.match(saraLine, /,'=HYPERLINK\(evil\),/, "formula neutralised");
    assert.equal(lines.length, 1 + 3, "header + 3 active students");
  });

  await t.test("other schools and Super Admins cannot edit this register", async () => {
    const other = await makeSchool();
    const b = new Client();
    await b.login(other.admin.email, other.admin.password);
    const r = await b.action<{ ok: boolean; error?: string }>("/school/attendance", "setAttendance", [ali.id, today, "ABSENT"]);
    assert.equal(r.result.ok, false);
    assert.doesNotMatch((await b.get("/school/attendance")).text, /Ali Register/);
    assert.doesNotMatch((await b.get(`/school/attendance/export?month=${month}`)).html, /Ali Register/);
    const sa = await makeSuperAdmin();
    const c = new Client();
    await c.login(sa.email, sa.password);
    await c.action("/school/attendance", "setAttendance", [ali.id, today, "ABSENT"]);
    const row = await sys((tx) => tx.attendance.findUnique({ where: { studentId_date: { studentId: ali.id, date: day(today) } } }));
    assert.equal(row?.status, "PRESENT");
  });
});
