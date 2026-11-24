import { isValidTimeZone } from "@/lib/timezones";

/** Time zone for showing dates in the Super Admin panel (from PLATFORM_TIMEZONE). */
export const PLATFORM_TIME_ZONE = (() => {
  const zone = process.env.PLATFORM_TIMEZONE ?? "UTC";
  return isValidTimeZone(zone) ? zone : "UTC";
})();
