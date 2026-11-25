import { test } from "node:test";
import assert from "node:assert/strict";
import QRCode from "qrcode";
import jsQR from "jsqr";
import { Client, Form, makeSchool, sys, uid } from "./lib";
import { newQrToken, qrPayload, tokenFromScan } from "../../src/lib/students";
import { todayInZone } from "../../src/lib/dates";
import type { ScanResult } from "../../src/app/school/scan/types";

async function student(schoolId: number, extra: { status?: "ACTIVE" | "INACTIVE" } = {}) {
  return sys((tx) =>
    tx.student.create({ data: { schoolId, studentCode: `Q-${uid()}`, fullName: `Scan Kid ${uid()}`, qrToken: newQrToken(), ...extra } }),
  );
}
const scan = async (c: Client, text: string) => (await c.action<ScanResult>("/school/scan", "scanQr", [text])).result;

test("QR cards and scanning (Phases 8 + 9)", async (t) => {
  const school = await makeSchool({ timezone: "Asia/Karachi" });
  const a = new Client();
  await a.login(school.admin.email, school.admin.password);

  await t.test("QR encodes only the opaque token and decodes back", async () => {
    const token = newQrToken();
    // Render the QR matrix to pixels (4 px per module, 4-module white margin) and decode it like the scanner does.
    const { modules } = QRCode.create(qrPayload(token), { errorCorrectionLevel: "M" });
    const scale = 4;
    const size = (modules.size + 8) * scale;
    const px = new Uint8ClampedArray(size * size * 4).fill(255);
    for (let y = 0; y < modules.size; y++)
      for (let x = 0; x < modules.size; x++)
        if (modules.get(y, x))
          for (let dy = 0; dy < scale; dy++)
            for (let dx = 0; dx < scale; dx++) {
              const i = (((y + 4) * scale + dy) * size + (x + 4) * scale + dx) * 4;
              px[i] = px[i + 1] = px[i + 2] = 0;
            }
    const decoded = jsQR(px, size, size);
    assert.equal(decoded?.data, `ATT1:${token}`);
    assert.equal(tokenFromScan(decoded!.data), token);
    assert.equal(tokenFromScan("https://example.com"), null);
  });

  await t.test("card pages show the QR but never the token as text", async () => {
    const s = await student(school.id);
    const card = await a.get(`/school/students/${s.id}/card`);
    assert.equal(card.status, 200);
    assert.match(card.html, /<svg/);
    assert.match(card.text, new RegExp(s.fullName));
    assert.ok(!card.html.includes(s.qrToken), "token not leaked in page");
    const sheet = await a.get("/school/cards");
    assert.match(sheet.text, new RegExp(s.fullName));
  });

  await t.test("scan: present, then already marked; school-local date", async () => {
    const s = await student(school.id);
    const r1 = await scan(a, qrPayload(s.qrToken));
    assert.equal(r1.kind, "ok");
    const r2 = await scan(a, qrPayload(s.qrToken));
    assert.equal(r2.kind, "duplicate");
    const rows = await sys((tx) => tx.attendance.findMany({ where: { studentId: s.id } }));
    assert.equal(rows.length, 1);
    assert.equal(rows[0].date.toISOString().slice(0, 10), todayInZone("Asia/Karachi"));
    assert.equal(rows[0].source, "QR_SCAN");
    // Bare token (handheld scanner without prefix) also works.
    const s2 = await student(school.id);
    assert.equal((await scan(a, `  ${s2.qrToken} `)).kind, "ok");
  });

  await t.test("5 simultaneous scans of one card mark it once", async () => {
    const s = await student(school.id);
    const results = await Promise.all(Array.from({ length: 5 }, () => scan(a, qrPayload(s.qrToken))));
    assert.equal(results.filter((r) => r.kind === "ok").length, 1);
    assert.equal(results.filter((r) => r.kind === "duplicate").length, 4);
    assert.equal(await sys((tx) => tx.attendance.count({ where: { studentId: s.id } })), 1);
  });

  await t.test("inactive student, unknown and foreign codes are refused", async () => {
    const off = await student(school.id, { status: "INACTIVE" });
    assert.equal((await scan(a, qrPayload(off.qrToken))).kind, "inactive");
    assert.equal((await scan(a, qrPayload(newQrToken()))).kind, "unknown");
    assert.equal((await scan(a, "hello world")).kind, "invalid");
    assert.equal(await sys((tx) => tx.attendance.count({ where: { studentId: off.id } })), 0);
  });

  await t.test("a card from another school is unknown here", async () => {
    const other = await makeSchool();
    const foreign = await student(other.id);
    const r = await scan(a, qrPayload(foreign.qrToken));
    assert.equal(r.kind, "unknown");
    assert.ok(!JSON.stringify(r).includes(foreign.fullName), "no data about the other school's student");
    assert.equal(await sys((tx) => tx.attendance.count({ where: { studentId: foreign.id } })), 0);
  });

  await t.test("a replaced (lost) card stops working", async () => {
    const s = await student(school.id);
    await a.action(`/school/students/${s.id}`, "regenerateQr", [undefined, new Form({ studentId: String(s.id) })]);
    assert.equal((await scan(a, qrPayload(s.qrToken))).kind, "unknown");
    const fresh = await sys((tx) => tx.student.findUniqueOrThrow({ where: { id: s.id } }));
    assert.equal((await scan(a, qrPayload(fresh.qrToken))).kind, "ok");
  });

  await t.test("scan after being marked absent turns it into present", async () => {
    const s = await student(school.id);
    await sys((tx) =>
      tx.attendance.create({ data: { studentId: s.id, schoolId: school.id, date: new Date(`${todayInZone("Asia/Karachi")}T00:00:00Z`), status: "ABSENT", source: "MANUAL" } }),
    );
    assert.equal((await scan(a, qrPayload(s.qrToken))).kind, "ok");
    const row = await sys((tx) => tx.attendance.findFirstOrThrow({ where: { studentId: s.id } }));
    assert.equal(row.status, "PRESENT");
  });

  await t.test("schools on opposite sides of the date line use their own 'today'", async () => {
    for (const tz of ["Pacific/Kiritimati", "Pacific/Pago_Pago"]) {
      const sch = await makeSchool({ timezone: tz });
      const c = new Client();
      await c.login(sch.admin.email, sch.admin.password);
      const s = await student(sch.id);
      assert.equal((await scan(c, qrPayload(s.qrToken))).kind, "ok");
      const row = await sys((tx) => tx.attendance.findFirstOrThrow({ where: { studentId: s.id } }));
      assert.equal(row.date.toISOString().slice(0, 10), todayInZone(tz), tz);
    }
  });

  await t.test("scan page loads; Super Admins cannot scan", async () => {
    assert.match((await a.get("/school/scan")).text, /Scan QR attendance/);
    const { makeSuperAdmin } = await import("./lib");
    const sa = await makeSuperAdmin();
    const c = new Client();
    await c.login(sa.email, sa.password);
    const s = await student(school.id);
    const r = await c.action("/school/scan", "scanQr", [qrPayload(s.qrToken)]);
    assert.notEqual((r.result as ScanResult | undefined)?.kind, "ok");
    assert.equal(await sys((tx) => tx.attendance.count({ where: { studentId: s.id } })), 0);
  });
});
