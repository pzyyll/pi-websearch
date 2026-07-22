// ABOUTME: tsdown config for compiling the pi-web-access extension entry to dist/.
// ABOUTME: Externalizes runtime/peer deps; preserves dynamic-import chunks for cold start.

import { defineConfig } from "tsdown";

export default defineConfig({
	entry: ["./src/index.ts"],
	format: ["esm"],
	platform: "node",
	outDir: "dist",
	clean: true,
	dts: false,
	sourcemap: true,
	// Keep package dependencies and peer deps external (Node resolves them at runtime).
	// Local dynamic imports become separate chunks so boot stays light.
	fixedExtension: true,
	failOnWarn: false,
});
