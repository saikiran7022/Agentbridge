import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import type { TestProject } from "vitest/node";

/** Applies migrations to the test database; database tests skip themselves when it is unreachable. */
export default function setup(project: TestProject) {
  const url = process.env.TEST_DATABASE_URL ?? "postgresql://hub:hub@localhost:5432/hub_test";
  try {
    execFileSync("pnpm", ["exec", "prisma", "migrate", "deploy"], {
      cwd: resolve(__dirname, "../packages/db"),
      env: { ...process.env, DATABASE_URL: url },
      stdio: "pipe",
    });
    project.provide("dbReady", true);
  } catch (err) {
    console.warn(`[test] database tests skipped: could not migrate ${url}\n${(err as Error).message.split("\n")[0]}`);
    project.provide("dbReady", false);
  }
}
