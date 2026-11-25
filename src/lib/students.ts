import { randomBytes } from "node:crypto";

/**
 * A new random QR token: 24 random bytes = 32 URL-safe characters.
 * It contains no personal data and cannot be guessed, so a printed card
 * reveals nothing and cannot be forged for another student.
 */
export function newQrToken(): string {
  return randomBytes(24).toString("base64url");
}

/** What the QR code on a card encodes. The prefix lets the scanner reject unrelated QR codes. */
export const QR_PREFIX = "ATT1:";
export function qrPayload(token: string): string {
  return `${QR_PREFIX}${token}`;
}

/** Extracts the token from scanned text (accepts with or without the prefix). */
export function tokenFromScan(raw: string): string | null {
  const s = raw.trim();
  const t = s.startsWith(QR_PREFIX) ? s.slice(QR_PREFIX.length) : s;
  return /^[A-Za-z0-9_-]{16,64}$/.test(t) ? t : null;
}

/** Largest photo accepted after the browser has resized it. */
export const MAX_PHOTO_BYTES = 300 * 1024;
export const PHOTO_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;

/** Detects the real image type from the file's first bytes (never trust the browser's label). */
export function sniffImageType(buf: Uint8Array): (typeof PHOTO_TYPES)[number] | null {
  if (buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "image/jpeg";
  if (buf.length > 8 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return "image/png";
  if (
    buf.length > 12 &&
    String.fromCharCode(...buf.slice(0, 4)) === "RIFF" &&
    String.fromCharCode(...buf.slice(8, 12)) === "WEBP"
  ) {
    return "image/webp";
  }
  return null;
}

/** "Ali Raza Khan" -> "AK" for photo placeholders. */
export function initials(name: string): string {
  const parts = name.trim().split(/\s+/);
  return ((parts[0]?.[0] ?? "") + (parts.length > 1 ? parts[parts.length - 1][0] : "")).toUpperCase();
}
