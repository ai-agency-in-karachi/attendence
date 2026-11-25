/** "1.5 MB", "820 KB", "2 GB" - binary units (1 MB = 1024 × 1024 bytes). */
export function formatBytes(bytes: number | bigint | null | undefined): string {
  const n = Number(bytes ?? 0);
  if (n < 1024) return `${n} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let v = n / 1024;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v >= 100 ? Math.round(v) : Number(v.toFixed(v >= 10 ? 1 : 2))} ${units[i]}`;
}

/** Money stored in minor units (e.g. paisa) -> "PKR 2,500.00". */
export function formatMoney(minor: number, currency: string): string {
  try {
    return new Intl.NumberFormat("en-US", { style: "currency", currency, currencyDisplay: "code" }).format(minor / 100);
  } catch {
    return `${currency} ${(minor / 100).toFixed(2)}`;
  }
}

/** Percentage 0-100 with one decimal, safe for zero totals. */
export function percent(part: number, total: number): number {
  return total > 0 ? Math.round((part / total) * 1000) / 10 : 0;
}
