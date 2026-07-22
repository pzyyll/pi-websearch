// ABOUTME: Measures the eager static import graph reachable from the extension entry.
// ABOUTME: Reports local file count/bytes, heavy npm markers, and optional jiti import timing.

import { readFileSync, statSync, existsSync } from "node:fs";
import { dirname, isAbsolute, join, normalize, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createRequire } from "node:module";
import { performance } from "node:perf_hooks";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const ENTRY = join(ROOT, "src", "index.ts");

const HEAVY_NPM = ["linkedom", "@mozilla/readability", "turndown", "unpdf"];
const HEAVY_LOCAL = ["curator-page", "extract", "gemini-web", "chrome-cookies"];

function stripCommentsAndStringsForScan(source) {
	// Keep import lines intact; only strip block comments that can hide edges.
	return source.replace(/\/\*[\s\S]*?\*\//g, (block) => {
		// Preserve newlines so line-oriented regex stays stable enough.
		return block.replace(/[^\n]/g, " ");
	});
}

function collectStaticSpecifiers(source) {
	const cleaned = stripCommentsAndStringsForScan(source);
	const specs = new Set();

	// Multi-line-friendly: match import/export ... from "spec" statements.
	const importFromRe = /(?:^|\n)\s*(import|export)(\s[\s\S]*?)\bfrom\s*["']([^"']+)["']\s*;?/g;
	const sideEffectRe = /(?:^|\n)\s*import\s*["']([^"']+)["']\s*;?/g;

	let match;
	while ((match = importFromRe.exec(cleaned)) !== null) {
		const kind = match[1];
		const clause = match[2] ?? "";
		const spec = match[3];
		const head = `${kind}${clause}`;
		if (/^(import|export)\s+type\b/.test(head.trim())) continue;
		// `import { type Foo }` only — treat as type-only.
		const brace = clause.match(/\{([^}]*)\}/);
		if (brace) {
			const outside = clause.replace(brace[0], "").replace(/\s/g, "");
			if (!outside || outside === "type") {
				const parts = brace[1]
					.split(",")
					.map((p) => p.trim())
					.filter(Boolean);
				if (
					parts.length > 0 &&
					parts.every((p) => p.startsWith("type ") || p === "type")
				) {
					continue;
				}
			}
		}
		specs.add(spec);
	}

	while ((match = sideEffectRe.exec(cleaned)) !== null) {
		specs.add(match[1]);
	}

	return [...specs];
}

function resolveLocal(fromFile, specifier) {
	if (!specifier.startsWith(".") && !specifier.startsWith("/")) return null;
	const base = isAbsolute(specifier) ? specifier : resolve(dirname(fromFile), specifier);
	const candidates = [
		base,
		`${base}.ts`,
		`${base}.js`,
		`${base}.mjs`,
		join(base, "index.ts"),
		join(base, "index.js"),
	];
	for (const candidate of candidates) {
		if (existsSync(candidate) && statSync(candidate).isFile()) {
			return normalize(candidate);
		}
	}
	return null;
}

function walkEagerGraph(entry) {
	const queue = [entry];
	const visited = new Set();
	const files = [];
	const npmHits = new Map(); // package -> [files]
	const edges = [];

	while (queue.length > 0) {
		const file = queue.shift();
		const normalized = normalize(file);
		if (visited.has(normalized)) continue;
		visited.add(normalized);

		let source;
		try {
			source = readFileSync(normalized, "utf8");
		} catch {
			continue;
		}

		const size = statSync(normalized).size;
		files.push({
			file: relative(ROOT, normalized).replaceAll("\\", "/"),
			bytes: size,
		});

		const specs = collectStaticSpecifiers(source);
		for (const spec of specs) {
			const isNpm = !spec.startsWith(".") && !spec.startsWith("/") && !spec.startsWith("node:");
			if (isNpm) {
				const pkg = spec.startsWith("@")
					? spec.split("/").slice(0, 2).join("/")
					: spec.split("/")[0];
				if (!npmHits.has(pkg)) npmHits.set(pkg, []);
				npmHits.get(pkg).push(relative(ROOT, normalized).replaceAll("\\", "/"));
				continue;
			}

			const resolved = resolveLocal(normalized, spec);
			if (!resolved) continue;
			if (!resolved.startsWith(ROOT)) continue;
			edges.push({
				from: relative(ROOT, normalized).replaceAll("\\", "/"),
				to: relative(ROOT, resolved).replaceAll("\\", "/"),
				spec,
			});
			queue.push(resolved);
		}
	}

	return { files, npmHits, edges };
}

function findHeavyLocalMarkers(files) {
	const names = files.map((f) => f.file);
	const markers = {};
	for (const key of HEAVY_LOCAL) {
		markers[key] = names.filter(
			(n) => n === `${key}.ts` || n.endsWith(`/${key}.ts`) || n.includes(`${key}.`),
		);
	}
	return markers;
}

function findHeavyNpmMarkers(npmHits) {
	const markers = {};
	for (const pkg of HEAVY_NPM) {
		markers[pkg] = npmHits.get(pkg) ?? [];
	}
	return markers;
}

async function maybeTimeJiti(entry) {
	if (!process.argv.includes("--jiti")) {
		return { skipped: true, reason: "pass --jiti to time jiti.import" };
	}

	const require = createRequire(import.meta.url);
	let jitiFactory;
	const candidates = [
		() => require("jiti"),
		() => require(createRequire(join(ROOT, "package.json")).resolve("jiti")),
	];

	// Walk up looking for a pi install that depends on jiti.
	let dir = ROOT;
	for (let i = 0; i < 8; i++) {
		const tryPaths = [
			join(dir, "node_modules", "jiti"),
			join(dir, "node_modules", "@earendil-works", "pi-coding-agent", "node_modules", "jiti"),
		];
		for (const p of tryPaths) {
			if (existsSync(p)) {
				candidates.push(() => createRequire(join(p, "package.json"))(p));
			}
		}
		const parent = dirname(dir);
		if (parent === dir) break;
		dir = parent;
	}

	for (const load of candidates) {
		try {
			jitiFactory = load();
			break;
		} catch {
			// try next
		}
	}

	if (!jitiFactory) {
		return { skipped: true, reason: "jiti not resolvable from local installs" };
	}

	const createJiti = typeof jitiFactory === "function" ? jitiFactory : jitiFactory.createJiti ?? jitiFactory.default;
	if (typeof createJiti !== "function") {
		return { skipped: true, reason: "jiti module shape not recognized" };
	}

	const jiti = createJiti(join(ROOT, "measure-import-graph"), {
		interopDefault: true,
		// Avoid writing cache noise during measurement.
		moduleCache: false,
	});

	const start = performance.now();
	try {
		if (typeof jiti.import === "function") {
			await jiti.import(pathToFileURL(entry).href);
		} else {
			jiti(entry);
		}
		const ms = performance.now() - start;
		return { skipped: false, ms: Math.round(ms * 100) / 100 };
	} catch (err) {
		const ms = performance.now() - start;
		return {
			skipped: false,
			ms: Math.round(ms * 100) / 100,
			error: err instanceof Error ? err.message : String(err),
		};
	}
}

const graph = walkEagerGraph(ENTRY);
const totalBytes = graph.files.reduce((sum, f) => sum + f.bytes, 0);
const heavyLocal = findHeavyLocalMarkers(graph.files);
const heavyNpm = findHeavyNpmMarkers(graph.npmHits);
const jitiTiming = await maybeTimeJiti(ENTRY);

const summary = {
	entry: relative(ROOT, ENTRY).replaceAll("\\", "/"),
	eagerLocalFileCount: graph.files.length,
	eagerLocalBytes: totalBytes,
	eagerLocalFiles: graph.files.map((f) => f.file).sort(),
	heavyLocalMarkers: heavyLocal,
	heavyNpmMarkers: heavyNpm,
	eagerNpmPackages: [...graph.npmHits.keys()].sort(),
	jiti: jitiTiming,
};

// Human-readable block
console.log("pi-web-access import graph");
console.log(`  entry: ${summary.entry}`);
console.log(`  eager local files: ${summary.eagerLocalFileCount} (${summary.eagerLocalBytes} bytes)`);
console.log("  files:");
for (const f of summary.eagerLocalFiles) {
	const bytes = graph.files.find((x) => x.file === f)?.bytes ?? 0;
	console.log(`    - ${f} (${bytes})`);
}
console.log("  heavy local markers:");
for (const [k, v] of Object.entries(heavyLocal)) {
	console.log(`    ${k}: ${v.length ? v.join(", ") : "(none)"}`);
}
console.log("  heavy npm markers:");
for (const [k, v] of Object.entries(heavyNpm)) {
	console.log(`    ${k}: ${v.length ? `via ${v.join(", ")}` : "(none)"}`);
}
if (jitiTiming.skipped) {
	console.log(`  jiti: skipped (${jitiTiming.reason})`);
} else if (jitiTiming.error) {
	console.log(`  jiti: ${jitiTiming.ms}ms (error: ${jitiTiming.error})`);
} else {
	console.log(`  jiti: ${jitiTiming.ms}ms`);
}

// Machine-readable single line for before/after paste
console.log(`JSON_SUMMARY ${JSON.stringify(summary)}`);
