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

test("package.json has build and prepublishOnly scripts", () => {
	assert.equal(pkg.scripts?.build, "tsdown");
	assert.equal(pkg.scripts?.prepublishOnly, "npm run build");
});

test("dist/index.js exists after build and keeps dynamic import chunks", () => {
	const entry = join(root, "dist", "index.js");
	assert.ok(existsSync(entry), "dist/index.js missing — run npm run build");
	const src = readFileSync(entry, "utf8");
	assert.match(src, /import\("\.\/extract-[^"]+\.js"\)/);
	assert.match(src, /import\("\.\/gemini-search-[^"]+\.js"\)/);
	assert.match(src, /import\("\.\/curator-server-[^"]+\.js"\)/);

	const files = readdirSync(join(root, "dist"));
	assert.ok(files.some((f) => f.startsWith("extract-") && f.endsWith(".js")));
	assert.ok(files.some((f) => f.startsWith("curator-page-") && f.endsWith(".js")));
});
