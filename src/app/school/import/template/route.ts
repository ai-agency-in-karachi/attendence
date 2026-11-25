import writeXlsxFile from "write-excel-file/node";
import { requireSchoolAdmin } from "@/lib/auth/dal";
import { schoolDb } from "@/lib/db";
import { TEMPLATE_EXAMPLES, TEMPLATE_HEADERS } from "@/lib/import";

/** Downloads the import template: /school/import/template?format=xlsx (default) or csv. */
export async function GET(req: Request) {
  const user = await requireSchoolAdmin();
  const format = new URL(req.url).searchParams.get("format") === "csv" ? "csv" : "xlsx";

  if (format === "csv") {
    const lines = [TEMPLATE_HEADERS, ...TEMPLATE_EXAMPLES].map((r) => r.map((c) => `"${c.replace(/"/g, '""')}"`).join(","));
    // BOM so Excel opens UTF-8 names (e.g. Urdu, accents) correctly.
    return new Response(`﻿${lines.join("\r\n")}\r\n`, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": 'attachment; filename="students-template.csv"',
        "Cache-Control": "no-store",
      },
    });
  }

  const classes = await schoolDb(user, (tx) =>
    tx.classGroup.findMany({ where: { isActive: true }, orderBy: [{ sortOrder: "asc" }, { name: "asc" }], select: { name: true } }),
  );
  const head = TEMPLATE_HEADERS.map((h) => ({ value: h, fontWeight: "bold" as const, backgroundColor: "#E2E8F0" }));
  const buffer = await writeXlsxFile([
    {
      sheet: "Students",
      data: [head, ...TEMPLATE_EXAMPLES.map((r) => r.map((v) => ({ value: v, type: String })))],
      columns: [{ width: 18 }, { width: 32 }, { width: 18 }],
      stickyRowsCount: 1,
    },
    {
      sheet: "How to fill",
      data: [
        [{ value: "How to fill this file", fontWeight: "bold" as const }],
        ["1. Keep the first row (column names) of the Students sheet as it is."],
        ["2. One student per row. Replace the two example rows with your students."],
        ["3. Student ID: required, unique in your school (admission or roll number)."],
        ["4. Full Name: required."],
        ["5. Class: optional. Use the names below; new names can be created during import."],
        [""],
        [{ value: "Your current classes", fontWeight: "bold" as const }],
        ...(classes.length ? classes.map((c) => [c.name]) : [["(none yet)"]]),
      ],
      columns: [{ width: 80 }],
    },
  ]).toBuffer();

  return new Response(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": 'attachment; filename="students-template.xlsx"',
      "Cache-Control": "no-store",
    },
  });
}
