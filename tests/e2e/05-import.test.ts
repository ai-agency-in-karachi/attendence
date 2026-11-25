import { test } from "node:test";
import assert from "node:assert/strict";
import writeXlsxFile from "write-excel-file/node";
import { readSheet } from "read-excel-file/node";
import { Client, Form, makeSchool, sys } from "./lib";
import type { ImportReport } from "../../src/lib/import-types";

const csv = (rows: string[][]) => new Blob([rows.map((r) => r.join(",")).join("\r\n")], { type: "text/csv" });
const file = (blob: Blob, name: string) => new File([blob], name, { type: blob.type });

async function run(c: Client, f: File, intent: "preview" | "commit", extra: Record<string, string> = {}) {
  const r = await c.action<{ ok?: boolean; error?: string; data?: ImportReport }>("/school/import", "importStudents", [
    undefined,
    new Form({ file: f, intent, mode: "skip", createClasses: "on", lastModified: "1", ...extra }),
  ]);
  return r.result;
}

test("bulk import (Phase 7)", async (t) => {
  const school = await makeSchool();
  const a = new Client();
  await a.login(school.admin.email, school.admin.password);
  await sys((tx) => tx.student.create({ data: { schoolId: school.id, studentCode: "OLD-1", fullName: "Existing Student", qrToken: "existing-token-0000000000001" } }));

  await t.test("templates download as real Excel and CSV files", async () => {
    const x = await fetch(`${process.env.E2E_BASE_URL}/school/import/template`, { headers: { cookie: `sid=${a.cookie}` } });
    assert.equal(x.status, 200);
    assert.match(x.headers.get("content-type") ?? "", /spreadsheetml/);
    const rows = await readSheet(Buffer.from(await x.arrayBuffer()));
    assert.deepEqual(rows[0], ["Student ID", "Full Name", "Class"]);
    const c = await a.get("/school/import/template?format=csv");
    assert.match(c.html, /Student ID/);
    assert.equal((await new Client().get("/school/import/template")).status, 307, "signed-out users are redirected");
  });

  const rows = [
    ["Student ID", "Full Name", "Class"],
    ["A-1", "Ayesha Khan", "Grade 1"],
    ["A-2", "Bilal Ahmed", "Grade 1"],
    ["a-1", "Copy Of Ayesha", ""],
    ["A-3", "", "Grade 2"],
    ["old-1", "Existing Renamed", "Grade 2"],
    ["", "", ""],
    ['"A-4"', '"Khan, Sara"', "Grade 2"],
  ];

  await t.test("preview: detects duplicates, errors, existing IDs and new classes; saves nothing", async () => {
    const r = await run(a, file(csv(rows), "students.csv"), "preview");
    const d = r.data!;
    assert.equal(d.total, 6);
    assert.equal(d.create, 2, "A-2 and A-4");
    assert.equal(d.skip, 1, "OLD-1 exists");
    assert.equal(d.errors, 3, "A-1 twice + missing name");
    assert.deepEqual(d.newClasses.sort(), ["Grade 1", "Grade 2"]);
    assert.ok(d.rows.find((x) => x.line === 2)?.messages.join(" ").includes("more than once"));
    assert.equal(await sys((tx) => tx.student.count({ where: { schoolId: school.id } })), 1);
  });

  await t.test("commit: imports valid rows, creates classes, unique QR tokens, audited", async () => {
    const r = await run(a, file(csv(rows), "students.csv"), "commit");
    assert.equal(r.data?.stage, "done");
    const students = await sys((tx) => tx.student.findMany({ where: { schoolId: school.id }, include: { classGroup: true } }));
    assert.equal(students.length, 3);
    const sara = students.find((s) => s.studentCode === "A-4");
    assert.equal(sara?.fullName, "Khan, Sara");
    assert.equal(sara?.classGroup?.name, "Grade 2");
    assert.equal(new Set(students.map((s) => s.qrToken)).size, 3);
    assert.equal(students.find((s) => s.studentCode === "OLD-1")?.fullName, "Existing Student", "skip mode keeps data");
    assert.ok(await sys((tx) => tx.auditLog.findFirst({ where: { schoolId: school.id, action: "student.import" } })));
    // Running the same file again adds nothing new.
    const again = await run(a, file(csv(rows), "students.csv"), "commit");
    assert.match(again.error ?? "", /Nothing to import/);
  });

  await t.test("update mode changes existing students", async () => {
    const r = await run(a, file(csv([["Name", "Admission No", "Section"], ["Ayesha K. Updated", "A-2", "Grade 9"]]), "u.csv"), "commit", { mode: "update" });
    assert.equal(r.data?.update, 1);
    const s = await sys((tx) => tx.student.findFirstOrThrow({ where: { schoolId: school.id, studentCode: "A-2" }, include: { classGroup: true } }));
    assert.equal(s.fullName, "Ayesha K. Updated");
    assert.equal(s.classGroup?.name, "Grade 9");
  });

  await t.test("Excel (.xlsx) upload works, including numeric IDs", async () => {
    const buf = await writeXlsxFile([["Student ID", "Full Name", "Class"], [5001, "Excel Kid", "Grade 1"]]).toBuffer();
    const r = await run(a, file(new Blob([new Uint8Array(buf)]), "list.xlsx"), "commit");
    assert.equal(r.data?.create, 1);
    assert.ok(await sys((tx) => tx.student.findFirst({ where: { schoolId: school.id, studentCode: "5001" } })));
  });

  await t.test("bad files are explained", async () => {
    assert.match((await run(a, file(new Blob(["just text"]), "x.pdf"), "preview")).error ?? "", /Excel \(\.xlsx\) or CSV/);
    assert.match((await run(a, file(csv([["Foo", "Bar"], ["1", "2"]]), "x.csv"), "preview")).error ?? "", /not found: Student ID, Full Name/);
    assert.match((await run(a, file(new Blob([""]), "x.csv"), "preview")).error ?? "", /Choose an Excel|empty/);
  });

  await t.test("storage quota blocks the whole import", async () => {
    const small = await makeSchool({ quotaMb: 0.002 }); // ~2 KB: room for ~4 students
    const c = new Client();
    await c.login(small.admin.email, small.admin.password);
    const many = [["Student ID", "Full Name"], ...Array.from({ length: 20 }, (_, i) => [`Q-${i}`, `Quota Kid ${i}`])];
    const p = await run(c, file(csv(many), "many.csv"), "preview");
    assert.equal(p.data?.storage.enough, false);
    const r = await run(c, file(csv(many), "many.csv"), "commit");
    assert.match(r.error ?? "", /Not enough storage/);
    assert.equal(await sys((tx) => tx.student.count({ where: { schoolId: small.id } })), 0, "all-or-nothing");
  });

  await t.test("imports stay inside the school", async () => {
    const other = await makeSchool();
    const b = new Client();
    await b.login(other.admin.email, other.admin.password);
    const r = await run(b, file(csv([["Student ID", "Full Name", "Class"], ["A-4", "Other School Sara", "Grade 2"]]), "b.csv"), "commit", { mode: "update" });
    assert.equal(r.data?.create, 1, "same ID in another school is a NEW student there");
    const mine = await sys((tx) => tx.student.findFirstOrThrow({ where: { schoolId: school.id, studentCode: "A-4" } }));
    assert.equal(mine.fullName, "Khan, Sara");
    const cls = await sys((tx) => tx.classGroup.count({ where: { schoolId: other.id, name: "Grade 2" } }));
    assert.equal(cls, 1);
  });
});
