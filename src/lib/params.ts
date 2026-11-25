/** Helpers for reading URL search params safely. */

export type SearchParams = Record<string, string | string[] | undefined>;

/** First value of a search param ("" when missing). */
export function one(v: string | string[] | undefined): string {
  return ((Array.isArray(v) ? v[0] : v) ?? "").slice(0, 200);
}

/** Page number from the URL, clamped to 1..10000. */
export function pageParam(v: string | string[] | undefined): number {
  return Math.max(1, Math.min(10_000, Number.parseInt(one(v), 10) || 1));
}

/** Builds "/path?a=1&b=2", dropping empty values. */
export function withQuery(path: string, params: Record<string, string | number | undefined | null>): string {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null || v === "") continue;
    if (k === "page" && Number(v) <= 1) continue; // page 1 is the default
    sp.set(k, String(v));
  }
  const s = sp.toString();
  return s ? `${path}?${s}` : path;
}
