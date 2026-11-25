/**
 * Runs the end-to-end test suite against a production build.
 *
 *   npm run build && npm run test:e2e            (all tests)
 *   npm run test:e2e -- tests/e2e/students.test.ts  (one file)
 *
 * Starts the app on port 3123, waits until it is healthy, runs the tests
 * one file at a time, removes all e2e test data, then stops the app.
 */
import { spawn } from "node:child_process";
import { readdirSync } from "node:fs";
import { cleanup, db } from "../tests/e2e/lib";

const PORT = "3123";

async function waitForHealth(timeoutMs = 60_000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const r = await fetch(`http://localhost:${PORT}/api/health`);
      if (r.ok) return;
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error("App did not become healthy in time");
}

async function main() {
  const files = process.argv.slice(2).length
    ? process.argv.slice(2)
    : readdirSync("tests/e2e")
        .filter((f) => f.endsWith(".test.ts"))
        .sort()
        .map((f) => `tests/e2e/${f}`);

  // A server left over from an older build would answer with stale code.
  if (await fetch(`http://localhost:${PORT}/api/health`).then(() => true, () => false)) {
    throw new Error(`Port ${PORT} is already in use by an old app server. Stop it first.`);
  }
  await cleanup();
  // detached = own process group, so we can stop npx AND the server it starts.
  const server = spawn("npx", ["next", "start", "-p", PORT], { stdio: ["ignore", "ignore", "inherit"], detached: true });
  let code = 1;
  try {
    await waitForHealth();
    code = await new Promise<number>((resolve) => {
      const t = spawn("npx", ["tsx", "--test", "--test-concurrency=1", ...files], {
        stdio: "inherit",
        env: { ...process.env, E2E_BASE_URL: `http://localhost:${PORT}` },
      });
      t.on("exit", (c) => resolve(c ?? 1));
    });
  } finally {
    try {
      process.kill(-server.pid!, "SIGTERM");
    } catch {
      server.kill("SIGTERM");
    }
    await cleanup();
    await db.$disconnect();
  }
  process.exit(code);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
