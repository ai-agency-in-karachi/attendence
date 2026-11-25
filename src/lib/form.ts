import { z } from "zod";

/** What every form Server Action returns to its form. */
export type FormState =
  | {
      ok?: boolean;
      /** Success message shown above the form. */
      message?: string;
      /** General error shown above the form. */
      error?: string;
      fieldErrors?: Partial<Record<string, string[]>>;
      /** Values typed by the user, echoed back after an error (never passwords). */
      values?: Record<string, string | boolean>;
      /** Free-form extra data for the form (e.g. import preview). */
      data?: unknown;
    }
  | undefined;

/** Reads text fields from FormData ("" when missing). */
export function readFields<K extends string>(formData: FormData, keys: readonly K[]): Record<K, string> {
  const out = {} as Record<K, string>;
  for (const k of keys) {
    const v = formData.get(k);
    out[k] = typeof v === "string" ? v : "";
  }
  return out;
}

/** Turns a Zod error into the form's error state. */
export function invalid(error: z.ZodError, values?: Record<string, string | boolean>): FormState {
  return {
    error: "Please fix the highlighted fields.",
    fieldErrors: z.flattenError(error).fieldErrors as Partial<Record<string, string[]>>,
    values,
  };
}

/** Drops password-like fields before echoing values back to the browser. */
export function safeValues(values: Record<string, string | boolean>): Record<string, string | boolean> {
  return Object.fromEntries(Object.entries(values).filter(([k]) => !/password/i.test(k)));
}

/** Positive integer id from a form/URL value, or null. */
export function toId(v: unknown): number | null {
  const s = typeof v === "string" ? v : String(v ?? "");
  if (!/^\d{1,9}$/.test(s)) return null;
  const n = Number(s);
  return n > 0 ? n : null;
}
