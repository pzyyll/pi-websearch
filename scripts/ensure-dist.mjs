// ABOUTME: Conditional postinstall helper: build dist only when entry is missing.
// ABOUTME: Avoids forcing tsdown/toolchain install on consumers that already ship dist/.

import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const DIST_ENTRY = join(ROOT, "dist", "index.js");

if (existsSync(DIST_ENTRY)) {
  process.exit(0);
}

console.log("[pi-web-access] dist/index.js missing; running npm run build…");
const result = spawnSync("npm", ["run", "build"], {
  cwd: ROOT,
  stdio: "inherit",
  shell: true,
  env: process.env,
});

if (result.error) {
  console.error(`[pi-web-access] failed to spawn build: ${result.error.message}`);
  process.exit(1);
}

process.exit(result.status ?? 1);
