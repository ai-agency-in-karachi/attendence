import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { cookies, headers } from "next/headers";
import { systemDb } from "@/lib/db";
import { SESSION_COOKIE } from "@/lib/auth/constants";

/**
 * Database-backed sessions.
 *
 * - The browser cookie holds a random 256-bit token.
 * - The database stores only the SHA-256 hash of that token.
 * - Logging out, deactivating a user or deactivating a school takes
 *   effect on the very next request.
 */

const SESSION_DAYS = 7;
const SESSION_MS = SESSION_DAYS * 24 * 60 * 60 * 1000;

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/** Best-effort client IP (set by Vercel / reverse proxies). */
export async function getClientIp(): Promise<string | null> {
  const h = await headers();
  const forwarded = h.get("x-forwarded-for")?.split(",")[0]?.trim();
  const ip = forwarded || h.get("x-real-ip") || null;
  return ip ? ip.slice(0, 45) : null;
}

/** Creates a session row and sets the cookie. Call only from Server Actions / Route Handlers. */
export async function createSession(userId: number): Promise<void> {
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + SESSION_MS);
  const h = await headers();
  const ipAddress = await getClientIp();
  const userAgent = h.get("user-agent")?.slice(0, 300) ?? null;

  await systemDb(async (tx) => {
    await tx.session.create({
      data: { id: hashToken(token), userId, expiresAt, ipAddress, userAgent },
    });
    // Housekeeping: drop this user's expired sessions.
    await tx.session.deleteMany({
      where: { userId, expiresAt: { lt: new Date() } },
    });
  });

  (await cookies()).set(SESSION_COOKIE, token, {
    httpOnly: true, // JavaScript in the page cannot read it
    secure: process.env.NODE_ENV === "production", // HTTPS only in production
    sameSite: "lax", // not sent on cross-site form posts (CSRF protection)
    path: "/",
    expires: expiresAt,
  });
}

/** Reads the cookie and returns the matching, unexpired session with its user. */
export async function readSession() {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token || token.length > 100) return null;

  // System scope: we don't know who the user is until this lookup finishes.
  const session = await systemDb((tx) =>
    tx.session.findUnique({
      where: { id: hashToken(token) },
      include: {
        user: {
          select: {
            id: true,
            role: true,
            email: true,
            fullName: true,
            isActive: true,
            schoolId: true,
            school: {
              select: {
                id: true,
                name: true,
                slug: true,
                status: true,
                timezone: true,
              },
            },
          },
        },
      },
    }),
  );

  if (!session || session.expiresAt <= new Date()) return null;
  return session;
}

/** Deletes the current session (row + cookie). Call only from Server Actions / Route Handlers. */
export async function destroyCurrentSession(): Promise<number | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE)?.value;
  cookieStore.delete(SESSION_COOKIE);
  if (!token) return null;

  return systemDb(async (tx) => {
    const session = await tx.session.findUnique({
      where: { id: hashToken(token) },
      select: { userId: true },
    });
    await tx.session.deleteMany({ where: { id: hashToken(token) } });
    return session?.userId ?? null;
  });
}

/** Logs a user out everywhere (e.g. after a password change or deactivation). */
export async function destroyAllSessionsForUser(userId: number): Promise<void> {
  await systemDb((tx) => tx.session.deleteMany({ where: { userId } }));
}
