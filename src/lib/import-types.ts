/** What the import action sends back to the page (safe to use in the browser). */

export type RowOutcome = "create" | "update" | "skip" | "error";

export type ReportRow = {
  line: number;
  studentCode: string;
  fullName: string;
  className: string | null;
  outcome: RowOutcome;
  messages: string[];
};

export type ImportReport = {
  stage: "preview" | "done";
  /** name|size|lastModified of the checked file, so the page knows the preview still matches. */
  fingerprint: string;
  fileName: string;
  total: number;
  create: number;
  update: number;
  skip: number;
  errors: number;
  newClasses: string[];
  /** Rows to show (problems first), capped for the browser. */
  rows: ReportRow[];
  storage: { enough: boolean; neededBytes: number; remainingBytes: number; noPlan: boolean };
};
