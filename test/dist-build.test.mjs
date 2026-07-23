// ABOUTME: Guards that package.json points at the prebuilt dist entry and chunks exist.
// ABOUTME: Ensures pi.extensions does not regress to loading TypeScript via jiti.

import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));

test("pi.extensions points at compiled dist entry", () => {
  assert.deepEqual(pkg.pi?.extensions, ["./dist/index.js"]);
});

test("package.json has build scripts", () => {
  assert.equal(pkg.scripts?.build, "tsdown");
});

test("dist/index.js exists after build and keeps dynamic import chunks", () => {
  const entry = join(root, "dist", "index.js");
  assert.ok(existsSync(entry), "dist/index.js missing — run npm run build");
  const src = readFileSync(entry, "utf8");
  // Minified builds may use import(`./chunk.js`); non-minified use "..." / '...' .
  const dynamicChunk = (name) => new RegExp("import\\([\"'`]\\./" + name + "-[^\"'`]+\\.js[\"'`]\\)");
  assert.match(src, dynamicChunk("extract"));
  assert.match(src, dynamicChunk("gemini-search"));
  assert.match(src, dynamicChunk("curator-server"));

  // Cold-start guard: entry must not embed heavy npm deps.
  assert.doesNotMatch(src, /from\s*["']linkedom["']/);
  assert.doesNotMatch(src, /from\s*["']unpdf["']/);
  assert.doesNotMatch(src, /from\s*["']@mozilla\/readability["']/);

  const files = readdirSync(join(root, "dist"));
  assert.ok(files.some((f) => f.startsWith("extract-") && f.endsWith(".js")));
  assert.ok(files.some((f) => f.startsWith("curator-page-") && f.endsWith(".js")));
  // Entry should stay a shell; feature work lives in hashed async chunks.
  assert.ok(files.filter((f) => f.endsWith(".js") && f !== "index.js").length >= 10);
});
