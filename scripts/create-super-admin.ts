/**
 * Creates a Super Admin account.
 *
 *   npm run create-super-admin
 *
 * Asks for email, name and password (the password is hidden while typing).
 * For automation, values can instead come from environment variables:
 *   SUPER_ADMIN_EMAIL, SUPER_ADMIN_NAME, SUPER_ADMIN_PASSWORD
 *
 * It never changes an existing account.
 */
import "dotenv/config";
import { createInterface } from "node:readline/promises";
import { PrismaClient } from "../src/generated/prisma/client";
import { createDbAdapter } from "../src/lib/db-adapter";
import { checkPasswordPolicy, hashPassword } from "../src/lib/auth/password";

async function askHidden(prompt: string): Promise<string> {
  const { stdin, stdout } = process;
  if (!stdin.isTTY) throw new Error("Password input needs an interactive terminal.");
  stdout.write(prompt);
  stdin.setRawMode(true);
  stdin.resume();
  stdin.setEncoding("utf8");
  return new Promise((resolve, reject) => {
    let value = "";
    const onData = (chunk: string) => {
      for (const ch of chunk) {
        if (ch === "\r" || ch === "\n") {
          stdin.off("data", onData);
          stdin.setRawMode(false);
          stdin.pause();
          stdout.write("\n");
          return resolve(value);
        }
        if (ch === "\u0003") {
          // Ctrl+C
          stdin.setRawMode(false);
          stdout.write("\n");
          return reject(new Error("Cancelled."));
        }
        if (ch === "\u007f" || ch === "\b") {
          if (value.length > 0) {
            value = value.slice(0, -1);
            stdout.write("\b \b");
          }
          continue;
        }
        value += ch;
        stdout.write("*");
      }
    };
    stdin.on("data", onData);
  });
}

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set (check your .env file).");
  const prisma = new PrismaClient({ adapter: createDbAdapter(url) });

  try {
    let email = process.env.SUPER_ADMIN_EMAIL ?? "";
    let fullName = process.env.SUPER_ADMIN_NAME ?? "";
    let password = process.env.SUPER_ADMIN_PASSWORD ?? "";

    if (!email || !fullName) {
      const rl = createInterface({ input: process.stdin, output: process.stdout });
      if (!email) email = await rl.question("Super Admin email: ");
      if (!fullName) fullName = await rl.question("Full name: ");
      rl.close();
    }
    email = email.trim().toLowerCase();
    fullName = fullName.trim();

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) {
      throw new Error("That doesn't look like a valid email address.");
    }
    if (!fullName || fullName.length > 200) throw new Error("Please enter a name (max 200 characters).");

    if (!password) {
      password = await askHidden("Password (min 10 characters): ");
      const again = await askHidden("Repeat password: ");
      if (password !== again) throw new Error("Passwords do not match.");
    }
    const policyError = checkPasswordPolicy(password);
    if (policyError) throw new Error(policyError);

    const existing = await prisma.user.findUnique({ where: { email }, select: { id: true } });
    if (existing) throw new Error(`A user with email ${email} already exists. Nothing was changed.`);

    const user = await prisma.user.create({
      data: {
        role: "SUPER_ADMIN",
        email,
        fullName,
        passwordHash: await hashPassword(password),
      },
      select: { id: true, email: true },
    });
    await prisma.auditLog.create({
      data: {
        action: "user.create_super_admin",
        entityType: "user",
        entityId: String(user.id),
        details: { via: "cli" },
      },
    });

    console.log(`\n✔ Super Admin created: ${user.email} (id ${user.id})`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  console.error(`\n✖ ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
