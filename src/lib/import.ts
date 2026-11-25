import "server-only";
import { readSheet } from "read-excel-file/node";
import { className as classNameSchema, studentCode as codeSchema, studentName as nameSchema } from "@/lib/validation/student";

/*
 * Student import: reads an Excel (.xlsx) or CSV file into rows and checks
 * every row. Nothing here touches the database; the action compares the
 * checked rows with existing students and saves them.
 */

export const MAX_IMPORT_BYTES = 2 * 1024 * 1024;
export const MAX_IMPORT_ROWS = 5000;

export type ParsedRow = {
  /** Row number as the user sees it in Excel (header = row 1). */
  line: number;
  studentCode: string;
  fullName: string;
  className: string | null;
  errors: string[];
};

export class ImportFileError extends Error {}

type Column = "studentCode" | "fullName" | "className";

/** Accepted header names (compared lowercase, without spaces/punctuation). */
const HEADERS: Record<Column, string[]> = {
  studentCode: ["studentid", "studentcode", "id", "admissionno", "admissionnumber", "rollno", "rollnumber", "regno", "registrationno", "code"],
  fullName: ["fullname", "name", "studentname", "studentfullname"],
  className: ["class", "classname", "section", "classsection", "grade", "group"],
};

const norm = (h: string) => h.toLowerCase().replace(/[^a-z0-9]/g, "");

function cellText(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === "number") return Number.isInteger(v) ? String(v) : String(v);
  return String(v).replace(/ /g, " ").trim();
}

/** Minimal RFC 4180 CSV reader: quotes, "" escapes, CRLF, and , ; or tab as separator. */
export function parseCsv(text: string): string[][] {
  const src = text.replace(/^﻿/, "");
  const firstLine = src.slice(0, src.search(/\r?\n|$/));
  const counts = [",", ";", "\t"].map((d) => [d, firstLine.split(d).length] as const);
  const delim = counts.sort((a, b) => b[1] - a[1])[0][0];

  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (quoted) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i++;
        } else quoted = false;
      } else field += ch;
    } else if (ch === '"' && field === "") quoted = true;
    else if (ch === delim) {
      row.push(field);
      field = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && src[i + 1] === "\n") i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else field += ch;
  }
  if (field !== "" || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

/** Reads the uploaded file into raw rows of text. */
export async function readTable(file: File): Promise<string[][]> {
  if (file.size === 0) throw new ImportFileError("The file is empty.");
  if (file.size > MAX_IMPORT_BYTES) throw new ImportFileError("The file is too large (max 2 MB). Split it into smaller files.");
  const name = file.name.toLowerCase();
  const buf = Buffer.from(await file.arrayBuffer());

  if (name.endsWith(".csv") || name.endsWith(".txt")) {
    return parseCsv(buf.toString("utf8"));
  }
  // .xlsx files are ZIP archives ("PK" signature).
  if (buf[0] === 0x50 && buf[1] === 0x4b) {
    try {
      const data = await readSheet(buf);
      return data.map((r) => r.map(cellText));
    } catch {
      throw new ImportFileError("This Excel file could not be read. Save it as .xlsx (Excel Workbook) or CSV and try again.");
    }
  }
  if (name.endsWith(".xls")) {
    throw new ImportFileError("Old .xls files are not supported. In Excel choose File → Save As → Excel Workbook (.xlsx).");
  }
  throw new ImportFileError("Upload an Excel (.xlsx) or CSV file.");
}

/** Finds the header row, maps columns and checks every data row. */
export function checkRows(table: string[][]): { rows: ParsedRow[]; hasClassColumn: boolean } {
  const headerIndex = table.findIndex((r) => r.some((c) => cellText(c) !== ""));
  if (headerIndex === -1) throw new ImportFileError("The file has no rows.");
  const header = table[headerIndex].map((h) => norm(cellText(h)));

  const col = {} as Record<Column, number>;
  for (const key of Object.keys(HEADERS) as Column[]) {
    col[key] = header.findIndex((h) => HEADERS[key].includes(h));
  }
  const missing = [col.studentCode === -1 && "Student ID", col.fullName === -1 && "Full Name"].filter(Boolean);
  if (missing.length) {
    throw new ImportFileError(
      `Column${missing.length > 1 ? "s" : ""} not found: ${missing.join(", ")}. The first row must contain the column names from the template (Student ID, Full Name, Class).`,
    );
  }

  const rows: ParsedRow[] = [];
  for (let i = headerIndex + 1; i < table.length; i++) {
    const r = table[i];
    const raw = (c: number) => (c >= 0 ? cellText(r[c]) : "");
    const codeRaw = raw(col.studentCode);
    const nameRaw = raw(col.fullName);
    const classRaw = raw(col.className);
    if (!codeRaw && !nameRaw && !classRaw) continue; // blank line
    if (rows.length >= MAX_IMPORT_ROWS) {
      throw new ImportFileError(`Too many rows (max ${MAX_IMPORT_ROWS.toLocaleString("en-US")} per file). Split the file.`);
    }

    const errors: string[] = [];
    const code = codeSchema.safeParse(codeRaw);
    const fullName = nameSchema.safeParse(nameRaw);
    const cls = classRaw ? classNameSchema.safeParse(classRaw) : null;
    if (!code.success) errors.push(`Student ID: ${code.error.issues[0].message}`);
    if (!fullName.success) errors.push(`Name: ${fullName.error.issues[0].message}`);
    if (cls && !cls.success) errors.push(`Class: ${cls.error.issues[0].message}`);
    rows.push({
      line: i + 1,
      studentCode: code.success ? code.data : codeRaw,
      fullName: fullName.success ? fullName.data : nameRaw,
      className: cls?.success ? cls.data : classRaw || null,
      errors,
    });
  }
  if (rows.length === 0) throw new ImportFileError("The file has column names but no students below them.");

  // The same student ID twice in the file: flag every copy.
  const seen = new Map<string, number[]>();
  for (const r of rows) {
    if (!r.studentCode) continue;
    const k = r.studentCode.toLowerCase();
    seen.set(k, [...(seen.get(k) ?? []), r.line]);
  }
  for (const r of rows) {
    const lines = seen.get(r.studentCode.toLowerCase());
    if (lines && lines.length > 1) {
      r.errors.push(`Student ID appears more than once in the file (rows ${lines.join(", ")}).`);
    }
  }
  return { rows, hasClassColumn: col.className !== -1 };
}

/** Column headers and example rows for the template. */
export const TEMPLATE_HEADERS = ["Student ID", "Full Name", "Class"] as const;
export const TEMPLATE_EXAMPLES = [
  ["1001", "Ayesha Khan", "Grade 5 - A"],
  ["1002", "Muhammad Ali", "Grade 5 - B"],
];
