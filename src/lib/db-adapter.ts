import { PrismaPg } from "@prisma/adapter-pg";

/**
 * Creates the PostgreSQL driver adapter used by every Prisma client
 * (the web app AND command-line scripts).
 *
 * IMPORTANT: the connection is forced to UTC. Without this, the pg driver
 * sends timestamps without a time-zone offset and PostgreSQL interprets
 * them in the SERVER's zone (e.g. Asia/Karachi), silently storing every
 * app-written time several hours off. School-local dates are handled
 * explicitly in code using each school's `timezone` setting instead.
 */
export function createDbAdapter(connectionString: string): PrismaPg {
  return new PrismaPg({ connectionString, options: "-c TimeZone=UTC" });
}
