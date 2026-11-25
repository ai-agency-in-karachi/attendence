export type ScannedStudent = {
  id: number;
  fullName: string;
  studentCode: string;
  photoKey: string | null;
  className: string | null;
};

export type ScanResult =
  | { kind: "ok"; student: ScannedStudent; time: string }
  | { kind: "duplicate"; student: ScannedStudent; time: string }
  | { kind: "inactive"; student: ScannedStudent }
  | { kind: "unknown" }
  | { kind: "invalid" };
