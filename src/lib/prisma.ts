import "server-only";
import { PrismaClient } from "@/generated/prisma/client";
import { createDbAdapter } from "@/lib/db-adapter";

/**
 * One shared database client for the whole server.
 *
 * In development, Next.js reloads code on every save. Without this
 * global cache, each reload would open new database connections until
 * PostgreSQL runs out of them.
 */
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

function createPrismaClient() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("DATABASE_URL is not set. Copy .env.example to .env and fill it in.");
  }
  return new PrismaClient({ adapter: createDbAdapter(connectionString) });
}

export const prisma = globalForPrisma.prisma ?? createPrismaClient();

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}
