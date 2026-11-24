/** All IANA time zones this server knows (e.g. "Asia/Karachi"), plus UTC. */
export const TIME_ZONES: readonly string[] = [
  "UTC",
  ...Intl.supportedValuesOf("timeZone").filter((z) => z !== "UTC"),
];

const KNOWN = new Set(TIME_ZONES);

export function isValidTimeZone(zone: string): boolean {
  return KNOWN.has(zone);
}

/** e.g. "UTC+05:00" for display next to a zone name. */
export function utcOffsetLabel(zone: string, at = new Date()): string {
  const part = new Intl.DateTimeFormat("en-US", { timeZone: zone, timeZoneName: "longOffset" })
    .formatToParts(at)
    .find((p) => p.type === "timeZoneName")?.value;
  return part === "GMT" || !part ? "UTC+00:00" : part.replace("GMT", "UTC");
}
