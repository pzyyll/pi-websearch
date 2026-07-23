// ABOUTME: Static guards that entry and facades do not hard-import heavy modules.
// ABOUTME: Protects cold-start lazy-loading boundaries from regressions.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const root = new URL("..", import.meta.url);
const indexSrc = readFileSync(new URL("../src/index.ts", import.meta.url), "utf8");
const geminiSearchSrc = readFileSync(new URL("../src/gemini-search.ts", import.meta.url), "utf8");
const curatorServerSrc = readFileSync(new URL("../src/curator-server.ts", import.meta.url), "utf8");
const extractSrc = readFileSync(new URL("../src/extract.ts", import.meta.url), "utf8");

/**
 * True when a source line is a static value import of the given module path.
 * Allows `import type` / type-only re-exports; forbids value imports.
 */
function hasStaticValueImport(source, modulePath) {
  const escaped = modulePath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const patterns = [
    new RegExp(String.raw`^\s*import\s+(?!type\b)[\s\S]*?from\s*["']${escaped}["']`, "m"),
    new RegExp(String.raw`^\s*export\s+(?!type\b)[\s\S]*?from\s*["']${escaped}["']`, "m"),
    new RegExp(String.raw`^\s*import\s*["']${escaped}["']`, "m"),
  ];
  // Line-oriented check so multi-line import type blocks are handled.
  const lines = source.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line.includes(modulePath)) continue;
    // Collect continued import statements starting at this line.
    let block = line;
    let j = i;
    while (!block.includes(";") && j + 1 < lines.length) {
      j++;
      block += " " + lines[j].trim();
    }
    if (/^import\s+type\b/.test(block) || /^export\s+type\b/.test(block)) continue;
    if (/^import\s*\{[^}]*\}\s*from/.test(block)) {
      const brace = block.match(/\{([^}]*)\}/);
      if (brace) {
        const parts = brace[1]
          .split(",")
          .map((p) => p.trim())
          .filter(Boolean);
        if (parts.length > 0 && parts.every((p) => p.startsWith("type ") || p === "type")) {
          continue;
        }
      }
    }
    for (const re of patterns) {
      if (re.test(block)) return true;
    }
    // Multi-line value import: `import {` ... `} from "./x"`
    if ((/^import\b/.test(block) && block.includes(`from "${modulePath}"`)) || block.includes(`from '${modulePath}'`)) {
      if (!/^import\s+type\b/.test(block)) return true;
    }
  }
  return false;
}

function hasStaticNpmImport(source, pkg) {
  // Line-scan only. A multiline import regex can false-positive by spanning from an
  // earlier value import to a later type-only from "pkg" clause.
  for (const line of source.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("import ")) continue;
    if (trimmed.startsWith("import type ")) continue;
    if (trimmed.includes(`"${pkg}"`) || trimmed.includes(`'${pkg}'`)) return true;
  }
  return false;
}

const INDEX_DENYLIST = [
  "./extract.ts",
  "./github-extract.ts",
  "./curator-server.ts",
  "./curator-page.ts",
  "./summary-review.ts",
  "./gemini-web.ts",
  "./chrome-cookies.ts",
  "./brave.ts",
  "./exa.ts",
  "./tavily.ts",
  "./parallel.ts",
  "./perplexity.ts",
  "./openai-search.ts",
  "./gemini-api.ts",
  "./gemini-search.ts",
];

const GEMINI_SEARCH_PROVIDER_DENYLIST = [
  "./brave.ts",
  "./exa.ts",
  "./tavily.ts",
  "./parallel.ts",
  "./perplexity.ts",
  "./openai-search.ts",
  "./gemini-api.ts",
  "./gemini-web.ts",
];

test("index.ts has no static value imports of heavy modules", () => {
  for (const mod of INDEX_DENYLIST) {
    assert.equal(hasStaticValueImport(indexSrc, mod), false, `index.ts must not statically value-import ${mod}`);
  }
  // Type-only extract / curator-server / summary-review are allowed
  assert.match(indexSrc, /import type \{ ExtractedContent \} from "\.\/extract\.ts"/);
  assert.match(indexSrc, /import type \{ CuratorServerHandle \} from "\.\/curator-server\.ts"/);
});

test("index.ts does not static-import pi-ai runtime values", () => {
  // Type-only Model is fine; complete/StringEnum must stay off the cold path.
  assert.equal(hasStaticNpmImport(indexSrc, "@earendil-works/pi-ai/compat"), false);
  assert.equal(hasStaticNpmImport(indexSrc, "@earendil-works/pi-ai"), false);
  assert.match(indexSrc, /import type \{ Model \} from "@earendil-works\/pi-ai\/compat"/);
  assert.match(indexSrc, /import\("@earendil-works\/pi-ai\/compat"\)/);
  assert.doesNotMatch(indexSrc, /\bStringEnum\b/);
});

test("gemini-search.ts has no static provider value imports", () => {
  for (const mod of GEMINI_SEARCH_PROVIDER_DENYLIST) {
    assert.equal(
      hasStaticValueImport(geminiSearchSrc, mod),
      false,
      `gemini-search.ts must not statically value-import ${mod}`,
    );
  }
});

test("curator-server.ts does not statically import curator-page.ts", () => {
  assert.equal(hasStaticValueImport(curatorServerSrc, "./curator-page.ts"), false);
  assert.match(curatorServerSrc, /import\("\.\/curator-page\.ts"\)/);
});

test("extract.ts does not statically import heavy HTML/PDF npm deps", () => {
  assert.equal(hasStaticNpmImport(extractSrc, "linkedom"), false);
  assert.equal(hasStaticNpmImport(extractSrc, "@mozilla/readability"), false);
  assert.equal(hasStaticNpmImport(extractSrc, "turndown"), false);
  assert.equal(hasStaticNpmImport(extractSrc, "unpdf"), false);
  assert.equal(hasStaticValueImport(extractSrc, "./pdf-extract.ts"), false);
  assert.match(extractSrc, /import\("linkedom"\)/);
  assert.match(extractSrc, /import\("@mozilla\/readability"\)/);
  assert.match(extractSrc, /import\("turndown"\)/);
});

// Silence unused root in some environments
void root;
