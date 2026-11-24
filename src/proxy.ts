import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE } from "@/lib/auth/constants";

/**
 * Quick, optimistic check only: if there is no session cookie at all,
 * send the visitor to /login before rendering anything.
 *
 * This does NOT verify the session (no database call here). The real
 * check happens in requireSuperAdmin()/requireSchoolAdmin() on every
 * protected page and Server Action.
 */
export default function proxy(req: NextRequest) {
  if (!req.cookies.has(SESSION_COOKIE)) {
    return NextResponse.redirect(new URL("/login", req.nextUrl));
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/super-admin/:path*", "/school/:path*"],
};
