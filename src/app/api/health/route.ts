import { connection } from "next/server";
import { prisma } from "@/lib/prisma";

/**
 * GET /api/health
 * Confirms the app is running and can reach the database.
 * Deliberately reveals no database names, users or error details.
 */
export async function GET() {
  await connection(); // always check live, never serve a cached answer

  try {
    await prisma.$queryRaw`SELECT 1`;
    return Response.json({ status: "ok", database: "connected" });
  } catch (error) {
    console.error("Health check: database unreachable", error);
    return Response.json({ status: "error", database: "unreachable" }, { status: 503 });
  }
}
