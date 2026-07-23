// ABOUTME: Benchmark jiti vs native import for dist/index.js under pi-like loader options.
// ABOUTME: Reproduces extension cold-start cost without starting the full pi CLI.

import { createRequire } from "node:module";
import { pathToFileURL, fileURLToPath } from "node:url";
import { performance } from "node:perf_hooks";
import path from "node:path";
import fs from "node:fs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ENTRY = process.argv[2]
  ? path.resolve(process.argv[2])
  : path.join(ROOT, "dist", "index.js");

// Prefer the jiti bundled with the host pi-coding-agent (same as extension loader).
const requireFromHere = createRequire(import.meta.url);
const candidateParents = [
  path.join(ROOT, "node_modules", "@earendil-works", "pi-coding-agent", "package.json"),
  "C:/Users/czllo/AppData/Local/mise/installs/node/26.3.0/node_modules/@earendil-works/pi-coding-agent/package.json",
];

function loadCreateJiti() {
  for (const parent of candidateParents) {
    if (!fs.existsSync(parent)) continue;
    const req = createRequire(parent);
    try {
      // jiti/static is used by pi loader; fall back to main export.
      try {
        const mod = req("jiti/static");
        return { createJiti: mod.createJiti ?? mod.default ?? mod, via: `${parent} -> jiti/static` };
      } catch {
        const mod = req("jiti");
        return { createJiti: mod.createJiti ?? mod.default ?? mod, via: `${parent} -> jiti` };
      }
    } catch {
      // try next
    }
  }
  // Last resort: package local
  try {
    const mod = requireFromHere("jiti");
    return { createJiti: mod.createJiti ?? mod.default ?? mod, via: "local jiti" };
  } catch (err) {
    throw new Error(`Cannot resolve jiti: ${err instanceof Error ? err.message : String(err)}`);
  }
}

function buildAliases(loaderDir) {
  const require = createRequire(path.join(loaderDir, "loader.js"));
  const packageIndex = path.resolve(loaderDir, "../..", "index.js");
  const resolvePkg = (spec) => {
    try {
      return require.resolve(spec);
    } catch {
      // Host may hoist packages differently; try from this package.
      try {
        return requireFromHere.resolve(spec);
      } catch {
        return null;
      }
    }
  };

  const typeboxEntry = resolvePkg("typebox");
  const typeboxCompileEntry = resolvePkg("typebox/compile");
  const typeboxValueEntry = resolvePkg("typebox/value");
  const piTuiEntry = resolvePkg("@earendil-works/pi-tui");
  const piAiCompatEntry = resolvePkg("@earendil-works/pi-ai/compat") ?? resolvePkg("@earendil-works/pi-ai");
  const piAgentCoreEntry = resolvePkg("@earendil-works/pi-agent-core");

  const aliases = {
    "@earendil-works/pi-coding-agent": packageIndex,
  };
  if (piAgentCoreEntry) aliases["@earendil-works/pi-agent-core"] = piAgentCoreEntry;
  if (piTuiEntry) aliases["@earendil-works/pi-tui"] = piTuiEntry;
  if (piAiCompatEntry) {
    aliases["@earendil-works/pi-ai"] = piAiCompatEntry;
    aliases["@earendil-works/pi-ai/compat"] = piAiCompatEntry;
  }
  if (typeboxEntry) {
    aliases.typebox = typeboxEntry;
    aliases["@sinclair/typebox"] = typeboxEntry;
  }
  if (typeboxCompileEntry) aliases["typebox/compile"] = typeboxCompileEntry;
  if (typeboxValueEntry) aliases["typebox/value"] = typeboxValueEntry;
  return aliases;
}

const { createJiti, via } = loadCreateJiti();
console.log(`jiti via: ${via}`);
console.log(`entry: ${ENTRY}`);
console.log(`exists: ${fs.existsSync(ENTRY)}`);

const loaderDirCandidates = [
  path.join(ROOT, "node_modules", "@earendil-works", "pi-coding-agent", "dist", "core", "extensions"),
  "C:/Users/czllo/AppData/Local/mise/installs/node/26.3.0/node_modules/@earendil-works/pi-coding-agent/dist/core/extensions",
];
const loaderDir = loaderDirCandidates.find((d) => fs.existsSync(path.join(d, "loader.js")));
if (!loaderDir) {
  throw new Error("Could not find pi-coding-agent extension loader dir");
}
const aliases = buildAliases(loaderDir);
console.log("aliases:");
for (const [k, v] of Object.entries(aliases)) {
  console.log(`  ${k} -> ${v}`);
}

const parent = pathToFileURL(path.join(loaderDir, "loader.js")).href;

async function measure(label, opts) {
  const jiti = createJiti(parent, opts);
  const start = performance.now();
  try {
    await jiti.import(ENTRY, { default: true });
    console.log(`${String(Math.round(performance.now() - start)).padStart(6)}ms OK  ${label}`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.log(
      `${String(Math.round(performance.now() - start)).padStart(6)}ms ERR ${label} :: ${msg.slice(0, 200)}`,
    );
  }
}

// Cases ordered to reveal which option dominates.
await measure("pi-like: moduleCache:false + alias", {
  moduleCache: false,
  alias: aliases,
});
await measure("moduleCache:true + alias", {
  moduleCache: true,
  alias: aliases,
});
await measure("tryNative:true + moduleCache:false + alias", {
  moduleCache: false,
  tryNative: true,
  alias: aliases,
});
await measure("tryNative:false + moduleCache:false + alias", {
  moduleCache: false,
  tryNative: false,
  alias: aliases,
});
await measure("no alias, moduleCache:false", {
  moduleCache: false,
});
await measure("no alias, tryNative:true", {
  moduleCache: false,
  tryNative: true,
});

{
  const start = performance.now();
  try {
    await import(pathToFileURL(ENTRY).href);
    console.log(`${String(Math.round(performance.now() - start)).padStart(6)}ms OK  native import()`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.log(
      `${String(Math.round(performance.now() - start)).padStart(6)}ms ERR native import() :: ${msg.slice(0, 200)}`,
    );
  }
}
