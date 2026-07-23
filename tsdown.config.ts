// ABOUTME: Cold-start-first tsdown config for the pi-web-access extension entry.
// ABOUTME: Keeps async feature chunks split, externalizes all npm deps, minifies output.

import { defineConfig } from "tsdown";

/**
 * Packaging goals (cold start > single-file size):
 * 1. Entry loads only the extension shell (tools/commands registration).
 * 2. Heavy features stay behind `import()` → separate dist chunks
 *    (extract, curator, providers, etc. via src/load-modules.ts).
 * 3. npm runtime deps (linkedom, unpdf, …) stay external so cold path
 *    does not parse them until a feature chunk is first used.
 * 4. Peer packages (@earendil-works/*, typebox) are always host-provided.
 * 5. No sourcemaps in published/git dist (less disk + no map side-loads).
 * 6. Minify for smaller parse/IO on every pi startup.
 *
 * Explicitly avoided:
 * - outputOptions.inlineDynamicImports (would collapse chunks into entry)
 * - deps.alwaysBundle (would inflate entry/feature chunks with node_modules)
 */
export default defineConfig({
  entry: ["./src/index.ts"],
  format: ["esm"],
  platform: "node",
  outDir: "dist",
  clean: true,
  dts: false,
  sourcemap: false,
  // Oxc minifier: smaller entry/chunks → less cold parse cost under jiti/node.
  minify: true,
  treeshake: true,
  // package.json has "type": "module", so emit .js (not .mjs via fixedExtension).
  fixedExtension: false,
  failOnWarn: false,
  deps: {
    // Never inline node_modules into any chunk (entry or async).
    // Runtime resolves dependencies/peers from the installed package + pi host.
    // (Preferred over deprecated deps.skipNodeModulesBundle.)
    neverBundle: true,
  },
});
