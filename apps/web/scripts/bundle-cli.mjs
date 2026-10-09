// Builds the single-file `hub` CLI and publishes it as /cli/hub.mjs so members can install it from their Hub.
import { execSync } from "node:child_process";
import { copyFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const web = join(dirname(fileURLToPath(import.meta.url)), "..");
const source = join(web, "..", "..", "packages", "cli", "dist", "hub.mjs");
const target = join(web, "public", "cli", "hub.mjs");

execSync("pnpm --filter @hub/cli build", { stdio: "inherit" });
mkdirSync(dirname(target), { recursive: true });
copyFileSync(source, target);
console.log(`hub CLI published at /cli/hub.mjs`);
