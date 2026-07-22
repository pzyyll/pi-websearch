import { r as getWebSearchConfigPath } from "./utils-_BNFawOs.mjs";
import { t as activityMonitor } from "./activity-Y0iQoAlM.mjs";
import { extname, join, resolve, sep } from "node:path";
import { execFile } from "node:child_process";
import { closeSync, existsSync, openSync, readFileSync, readSync, readdirSync, realpathSync, rmSync, statSync } from "node:fs";
//#region github-api.ts
const MAX_TREE_ENTRIES$1 = 200;
const MAX_INLINE_FILE_CHARS$1 = 1e5;
let ghAvailable = null;
let ghHintShown = false;
async function checkGhAvailable() {
	if (ghAvailable !== null) return ghAvailable;
	return new Promise((resolve) => {
		execFile("gh", ["--version"], { timeout: 5e3 }, (err) => {
			ghAvailable = !err;
			resolve(ghAvailable);
		});
	});
}
function showGhHint() {
	if (!ghHintShown) {
		ghHintShown = true;
		console.error("[pi-web-access] Install `gh` CLI for better GitHub repo access including private repos.");
	}
}
async function checkRepoSize(owner, repo) {
	if (!await checkGhAvailable()) return null;
	return new Promise((resolve) => {
		execFile("gh", [
			"api",
			`repos/${owner}/${repo}`,
			"--jq",
			".size"
		], { timeout: 1e4 }, (err, stdout) => {
			if (err) {
				resolve(null);
				return;
			}
			const kb = parseInt(stdout.trim(), 10);
			resolve(Number.isNaN(kb) ? null : kb);
		});
	});
}
async function getDefaultBranch(owner, repo) {
	if (!await checkGhAvailable()) return null;
	return new Promise((resolve) => {
		execFile("gh", [
			"api",
			`repos/${owner}/${repo}`,
			"--jq",
			".default_branch"
		], { timeout: 1e4 }, (err, stdout) => {
			if (err) {
				resolve(null);
				return;
			}
			resolve(stdout.trim() || null);
		});
	});
}
async function fetchTreeViaApi(owner, repo, ref) {
	if (!await checkGhAvailable()) return null;
	return new Promise((resolve) => {
		execFile("gh", [
			"api",
			`repos/${owner}/${repo}/git/trees/${ref}?recursive=1`,
			"--jq",
			".tree[].path"
		], {
			timeout: 15e3,
			maxBuffer: 5 * 1024 * 1024
		}, (err, stdout) => {
			if (err) {
				resolve(null);
				return;
			}
			const paths = stdout.trim().split("\n").filter(Boolean);
			if (paths.length === 0) {
				resolve(null);
				return;
			}
			const truncated = paths.length > MAX_TREE_ENTRIES$1;
			const display = paths.slice(0, MAX_TREE_ENTRIES$1).join("\n");
			resolve(truncated ? display + `\n... (${paths.length} total entries)` : display);
		});
	});
}
async function fetchReadmeViaApi(owner, repo, ref) {
	if (!await checkGhAvailable()) return null;
	return new Promise((resolve) => {
		execFile("gh", [
			"api",
			`repos/${owner}/${repo}/readme?ref=${ref}`,
			"--jq",
			".content"
		], { timeout: 1e4 }, (err, stdout) => {
			if (err) {
				resolve(null);
				return;
			}
			try {
				const decoded = Buffer.from(stdout.trim(), "base64").toString("utf-8");
				resolve(decoded.length > 8192 ? decoded.slice(0, 8192) + "\n\n[README truncated at 8K chars]" : decoded);
			} catch {
				resolve(null);
			}
		});
	});
}
async function fetchFileViaApi(owner, repo, path, ref) {
	if (!await checkGhAvailable()) return null;
	return new Promise((resolve) => {
		execFile("gh", [
			"api",
			`repos/${owner}/${repo}/contents/${path}?ref=${ref}`,
			"--jq",
			".content"
		], {
			timeout: 1e4,
			maxBuffer: 2 * 1024 * 1024
		}, (err, stdout) => {
			if (err) {
				resolve(null);
				return;
			}
			try {
				resolve(Buffer.from(stdout.trim(), "base64").toString("utf-8"));
			} catch {
				resolve(null);
			}
		});
	});
}
async function fetchViaApi(url, owner, repo, info, sizeNote) {
	const ref = info.ref || await getDefaultBranch(owner, repo);
	if (!ref) return null;
	const lines = [];
	if (sizeNote) {
		lines.push(sizeNote);
		lines.push("");
	}
	if (info.type === "blob" && info.path) {
		const content = await fetchFileViaApi(owner, repo, info.path, ref);
		if (!content) return null;
		lines.push(`## ${info.path}`);
		if (content.length > MAX_INLINE_FILE_CHARS$1) {
			lines.push(content.slice(0, MAX_INLINE_FILE_CHARS$1));
			lines.push(`\n[File truncated at 100K chars]`);
		} else lines.push(content);
		return {
			url,
			title: `${owner}/${repo} - ${info.path}`,
			content: lines.join("\n"),
			error: null
		};
	}
	const [tree, readme] = await Promise.all([fetchTreeViaApi(owner, repo, ref), fetchReadmeViaApi(owner, repo, ref)]);
	if (!tree && !readme) return null;
	if (tree) {
		lines.push("## Structure");
		lines.push(tree);
		lines.push("");
	}
	if (readme) {
		lines.push("## README.md");
		lines.push(readme);
		lines.push("");
	}
	lines.push("This is an API-only view. Clone the repo or use `read`/`bash` for deeper exploration.");
	return {
		url,
		title: info.path ? `${owner}/${repo} - ${info.path}` : `${owner}/${repo}`,
		content: lines.join("\n"),
		error: null
	};
}
//#endregion
//#region github-extract.ts
const CONFIG_PATH = getWebSearchConfigPath();
const BINARY_EXTENSIONS = /* @__PURE__ */ new Set([
	".png",
	".jpg",
	".jpeg",
	".gif",
	".bmp",
	".ico",
	".webp",
	".svg",
	".tiff",
	".tif",
	".mp3",
	".mp4",
	".avi",
	".mov",
	".mkv",
	".flv",
	".wmv",
	".wav",
	".ogg",
	".webm",
	".flac",
	".aac",
	".zip",
	".tar",
	".gz",
	".bz2",
	".xz",
	".7z",
	".rar",
	".zst",
	".exe",
	".dll",
	".so",
	".dylib",
	".bin",
	".o",
	".a",
	".lib",
	".woff",
	".woff2",
	".ttf",
	".otf",
	".eot",
	".pdf",
	".doc",
	".docx",
	".xls",
	".xlsx",
	".ppt",
	".pptx",
	".sqlite",
	".db",
	".sqlite3",
	".pyc",
	".pyo",
	".class",
	".jar",
	".war",
	".iso",
	".img",
	".dmg"
]);
const NOISE_DIRS = /* @__PURE__ */ new Set([
	"node_modules",
	"vendor",
	".next",
	"dist",
	"build",
	"__pycache__",
	".venv",
	"venv",
	".tox",
	".mypy_cache",
	".pytest_cache",
	"target",
	".gradle",
	".idea",
	".vscode"
]);
const MAX_INLINE_FILE_CHARS = 1e5;
const MAX_TREE_ENTRIES = 200;
const cloneCache = /* @__PURE__ */ new Map();
let cachedConfig = null;
function normalizeEnabled(value, fallback) {
	return typeof value === "boolean" ? value : fallback;
}
function normalizePositiveNumber(value, fallback) {
	if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
	return value > 0 ? value : fallback;
}
function normalizeClonePath(value, fallback) {
	if (typeof value !== "string") return fallback;
	const normalized = value.trim();
	return normalized.length > 0 ? normalized : fallback;
}
function loadGitHubConfig() {
	if (cachedConfig) return cachedConfig;
	const defaults = {
		enabled: true,
		maxRepoSizeMB: 350,
		cloneTimeoutSeconds: 30,
		clonePath: "/tmp/pi-github-repos"
	};
	if (!existsSync(CONFIG_PATH)) {
		cachedConfig = defaults;
		return cachedConfig;
	}
	const rawText = readFileSync(CONFIG_PATH, "utf-8");
	let raw;
	try {
		raw = JSON.parse(rawText);
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		throw new Error(`Failed to parse ${CONFIG_PATH}: ${message}`);
	}
	const gc = raw.githubClone ?? {};
	cachedConfig = {
		enabled: normalizeEnabled(gc.enabled, defaults.enabled),
		maxRepoSizeMB: normalizePositiveNumber(gc.maxRepoSizeMB, defaults.maxRepoSizeMB),
		cloneTimeoutSeconds: normalizePositiveNumber(gc.cloneTimeoutSeconds, defaults.cloneTimeoutSeconds),
		clonePath: normalizeClonePath(gc.clonePath, defaults.clonePath)
	};
	return cachedConfig;
}
const NON_CODE_SEGMENTS = /* @__PURE__ */ new Set([
	"issues",
	"pull",
	"pulls",
	"discussions",
	"releases",
	"wiki",
	"actions",
	"settings",
	"security",
	"projects",
	"graphs",
	"compare",
	"commits",
	"tags",
	"branches",
	"stargazers",
	"watchers",
	"network",
	"forks",
	"milestone",
	"labels",
	"packages",
	"codespaces",
	"contribute",
	"community",
	"sponsors",
	"invitations",
	"notifications",
	"insights"
]);
function parseGitHubUrl(url) {
	let parsed;
	try {
		parsed = new URL(url);
	} catch {
		return null;
	}
	const host = parsed.hostname.toLowerCase();
	if (host !== "github.com" && host !== "www.github.com") return null;
	const segments = parsed.pathname.split("/").filter(Boolean).map((segment) => {
		try {
			return decodeURIComponent(segment);
		} catch {
			return segment;
		}
	});
	if (segments.length < 2) return null;
	const owner = segments[0];
	const repo = segments[1].replace(/\.git$/, "");
	if (NON_CODE_SEGMENTS.has(segments[2]?.toLowerCase())) return null;
	if (segments.length === 2) return {
		owner,
		repo,
		refIsFullSha: false,
		type: "root"
	};
	const action = segments[2];
	if (action !== "blob" && action !== "tree") return null;
	if (segments.length < 4) return null;
	const ref = segments[3];
	const refIsFullSha = /^[0-9a-f]{40}$/.test(ref);
	const pathParts = segments.slice(4);
	return {
		owner,
		repo,
		ref,
		refIsFullSha,
		path: pathParts.length > 0 ? pathParts.join("/") : "",
		type: action
	};
}
function cacheKey(owner, repo, ref) {
	return ref ? `${owner}/${repo}@${ref}` : `${owner}/${repo}`;
}
function cloneDir(config, owner, repo, ref) {
	const dirName = ref ? `${repo}@${ref}` : repo;
	return join(config.clonePath, owner, dirName);
}
function execClone(args, localPath, timeoutMs, signal) {
	return new Promise((resolve) => {
		const child = execFile(args[0], args.slice(1), { timeout: timeoutMs }, (err) => {
			if (err) {
				try {
					rmSync(localPath, {
						recursive: true,
						force: true
					});
				} catch {}
				resolve(null);
				return;
			}
			resolve(localPath);
		});
		if (signal) {
			const onAbort = () => child.kill();
			signal.addEventListener("abort", onAbort, { once: true });
			child.on("exit", () => signal.removeEventListener("abort", onAbort));
		}
	});
}
async function cloneRepo(owner, repo, ref, config, signal) {
	const localPath = cloneDir(config, owner, repo, ref);
	try {
		rmSync(localPath, {
			recursive: true,
			force: true
		});
	} catch {}
	const timeoutMs = config.cloneTimeoutSeconds * 1e3;
	if (await checkGhAvailable()) {
		const args = [
			"gh",
			"repo",
			"clone",
			`${owner}/${repo}`,
			localPath,
			"--",
			"--depth",
			"1",
			"--single-branch"
		];
		if (ref) args.push("--branch", ref);
		return execClone(args, localPath, timeoutMs, signal);
	}
	showGhHint();
	const gitUrl = `https://github.com/${owner}/${repo}.git`;
	const args = [
		"git",
		"clone",
		"--depth",
		"1",
		"--single-branch"
	];
	if (ref) args.push("--branch", ref);
	args.push(gitUrl, localPath);
	return execClone(args, localPath, timeoutMs, signal);
}
function isBinaryFile(filePath) {
	const ext = extname(filePath).toLowerCase();
	if (BINARY_EXTENSIONS.has(ext)) return true;
	let fd;
	try {
		fd = openSync(filePath, "r");
	} catch {
		return false;
	}
	try {
		const buf = Buffer.alloc(512);
		const bytesRead = readSync(fd, buf, 0, 512, 0);
		for (let i = 0; i < bytesRead; i++) if (buf[i] === 0) return true;
	} catch {
		return false;
	} finally {
		closeSync(fd);
	}
	return false;
}
function formatFileSize(bytes) {
	if (bytes < 1024) return `${bytes} B`;
	if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
	return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
function resolveWithinRepo(rootPath, relativePath) {
	const normalizedRoot = resolve(rootPath);
	const candidate = resolve(normalizedRoot, relativePath);
	if (candidate !== normalizedRoot) {
		const rootPrefix = normalizedRoot.endsWith(sep) ? normalizedRoot : normalizedRoot + sep;
		if (!candidate.startsWith(rootPrefix)) return null;
	}
	if (!existsSync(candidate)) return candidate;
	try {
		const realRoot = realpathSync(normalizedRoot);
		const realCandidate = realpathSync(candidate);
		if (realCandidate === realRoot) return candidate;
		const realRootPrefix = realRoot.endsWith(sep) ? realRoot : realRoot + sep;
		return realCandidate.startsWith(realRootPrefix) ? candidate : null;
	} catch {
		return null;
	}
}
function readTextFile(path) {
	try {
		return readFileSync(path, "utf-8");
	} catch {
		return null;
	}
}
function buildTree(rootPath) {
	const entries = [];
	function walk(dir, relPath) {
		if (entries.length >= MAX_TREE_ENTRIES) return;
		let items;
		try {
			items = readdirSync(dir).sort();
		} catch {
			return;
		}
		for (const item of items) {
			if (entries.length >= MAX_TREE_ENTRIES) return;
			if (item === ".git") continue;
			const rel = relPath ? `${relPath}/${item}` : item;
			const safePath = resolveWithinRepo(rootPath, rel);
			if (!safePath) {
				entries.push(`${rel}  [outside repo skipped]`);
				continue;
			}
			let stat;
			try {
				stat = statSync(safePath);
			} catch {
				continue;
			}
			if (stat.isDirectory()) {
				if (NOISE_DIRS.has(item)) {
					entries.push(`${rel}/  [skipped]`);
					continue;
				}
				entries.push(`${rel}/`);
				walk(safePath, rel);
			} else entries.push(rel);
		}
	}
	walk(rootPath, "");
	if (entries.length >= MAX_TREE_ENTRIES) entries.push(`... (truncated at ${MAX_TREE_ENTRIES} entries)`);
	return entries.join("\n");
}
function buildDirListing(rootPath, subPath) {
	const targetPath = resolveWithinRepo(rootPath, subPath);
	if (!targetPath) return "(path escapes repository root)";
	const lines = [];
	let items;
	try {
		items = readdirSync(targetPath).sort();
	} catch {
		return "(directory not readable)";
	}
	for (const item of items) {
		if (item === ".git") continue;
		const safePath = resolveWithinRepo(rootPath, subPath ? `${subPath}/${item}` : item);
		if (!safePath) {
			lines.push(`  ${item}  (outside repo)`);
			continue;
		}
		try {
			const stat = statSync(safePath);
			if (stat.isDirectory()) lines.push(`  ${item}/`);
			else lines.push(`  ${item}  (${formatFileSize(stat.size)})`);
		} catch {
			lines.push(`  ${item}  (unreadable)`);
		}
	}
	return lines.join("\n");
}
function readReadme(localPath) {
	for (const name of [
		"README.md",
		"readme.md",
		"README",
		"README.txt",
		"README.rst"
	]) {
		const readmePath = join(localPath, name);
		if (existsSync(readmePath)) try {
			const content = readFileSync(readmePath, "utf-8");
			return content.length > 8192 ? content.slice(0, 8192) + "\n\n[README truncated at 8K chars]" : content;
		} catch {
			continue;
		}
	}
	return null;
}
function generateContent(localPath, info) {
	const lines = [];
	lines.push(`Repository cloned to: ${localPath}`);
	lines.push("");
	if (info.type === "root") {
		lines.push("## Structure");
		lines.push(buildTree(localPath));
		lines.push("");
		const readme = readReadme(localPath);
		if (readme) {
			lines.push("## README.md");
			lines.push(readme);
			lines.push("");
		}
		lines.push("Use `read` and `bash` tools at the path above to explore further.");
		return lines.join("\n");
	}
	if (info.type === "tree") {
		const dirPath = info.path || "";
		const fullDirPath = resolveWithinRepo(localPath, dirPath);
		if (!fullDirPath || !existsSync(fullDirPath)) {
			lines.push(`Path \`${dirPath}\` not found in clone. Showing repository root instead.`);
			lines.push("");
			lines.push("## Structure");
			lines.push(buildTree(localPath));
		} else {
			lines.push(`## ${dirPath || "/"}`);
			lines.push(buildDirListing(localPath, dirPath));
		}
		lines.push("");
		lines.push("Use `read` and `bash` tools at the path above to explore further.");
		return lines.join("\n");
	}
	if (info.type === "blob") {
		const filePath = info.path || "";
		const fullFilePath = resolveWithinRepo(localPath, filePath);
		if (!fullFilePath || !existsSync(fullFilePath)) {
			lines.push(`Path \`${filePath}\` not found in clone. Showing repository root instead.`);
			lines.push("");
			lines.push("## Structure");
			lines.push(buildTree(localPath));
			lines.push("");
			lines.push("Use `read` and `bash` tools at the path above to explore further.");
			return lines.join("\n");
		}
		let stat;
		try {
			stat = statSync(fullFilePath);
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
			lines.push(`Could not inspect \`${filePath}\`: ${message}`);
			lines.push("");
			lines.push("Use `read` and `bash` tools at the path above to explore further.");
			return lines.join("\n");
		}
		if (stat.isDirectory()) {
			lines.push(`## ${filePath || "/"}`);
			lines.push(buildDirListing(localPath, filePath));
			lines.push("");
			lines.push("Use `read` and `bash` tools at the path above to explore further.");
			return lines.join("\n");
		}
		if (isBinaryFile(fullFilePath)) {
			const ext = extname(filePath).replace(".", "");
			lines.push(`## ${filePath}`);
			lines.push(`Binary file (${ext}, ${formatFileSize(stat.size)}). Use \`read\` or \`bash\` tools at the path above to inspect.`);
			return lines.join("\n");
		}
		const content = readTextFile(fullFilePath);
		if (content === null) {
			lines.push(`Could not read \`${filePath}\` as UTF-8 text.`);
			lines.push("");
			lines.push("Use `read` and `bash` tools at the path above to explore further.");
			return lines.join("\n");
		}
		lines.push(`## ${filePath}`);
		if (content.length > MAX_INLINE_FILE_CHARS) {
			lines.push(content.slice(0, MAX_INLINE_FILE_CHARS));
			lines.push("");
			lines.push(`[File truncated at 100K chars. Full file: ${fullFilePath}]`);
		} else lines.push(content);
		lines.push("");
		lines.push("Use `read` and `bash` tools at the path above to explore further.");
		return lines.join("\n");
	}
	return lines.join("\n");
}
async function awaitCachedClone(cached, url, owner, repo, info, signal) {
	if (signal?.aborted) return null;
	const result = await cached.clonePromise;
	if (signal?.aborted) return null;
	if (result) {
		const content = generateContent(result, info);
		return {
			url,
			title: info.path ? `${owner}/${repo} - ${info.path}` : `${owner}/${repo}`,
			content,
			error: null
		};
	}
	return fetchViaApi(url, owner, repo, info);
}
async function extractGitHub(url, signal, forceClone) {
	const info = parseGitHubUrl(url);
	if (!info) return null;
	if (signal?.aborted) return null;
	const config = loadGitHubConfig();
	if (!config.enabled) return null;
	const { owner, repo } = info;
	const key = cacheKey(owner, repo, info.ref);
	const cached = cloneCache.get(key);
	if (cached) return awaitCachedClone(cached, url, owner, repo, info, signal);
	if (info.refIsFullSha) {
		if (signal?.aborted) return null;
		return fetchViaApi(url, owner, repo, info, `Note: Commit SHA URLs use the GitHub API instead of cloning.`);
	}
	const activityId = activityMonitor.logStart({
		type: "fetch",
		url: `github.com/${owner}/${repo}`
	});
	if (!forceClone) {
		const sizeKB = await checkRepoSize(owner, repo);
		if (signal?.aborted) {
			activityMonitor.logComplete(activityId, 0);
			return null;
		}
		if (sizeKB !== null) {
			const sizeMB = sizeKB / 1024;
			if (sizeMB > config.maxRepoSizeMB) {
				if (signal?.aborted) {
					activityMonitor.logComplete(activityId, 0);
					return null;
				}
				const apiView = await fetchViaApi(url, owner, repo, info, `Note: Repository is ${Math.round(sizeMB)}MB (threshold: ${config.maxRepoSizeMB}MB). Showing API-fetched content instead of full clone. Ask the user if they'd like to clone the full repo -- if yes, call fetch_content again with the same URL and add forceClone: true to the params.`);
				if (apiView) {
					activityMonitor.logComplete(activityId, 200);
					return apiView;
				}
				activityMonitor.logError(activityId, "api fallback unavailable for oversized repository");
				return null;
			}
		}
	}
	if (signal?.aborted) {
		activityMonitor.logComplete(activityId, 0);
		return null;
	}
	const cachedAfterSizeCheck = cloneCache.get(key);
	if (cachedAfterSizeCheck) {
		const cachedResult = await awaitCachedClone(cachedAfterSizeCheck, url, owner, repo, info, signal);
		if (signal?.aborted) activityMonitor.logComplete(activityId, 0);
		else if (cachedResult) activityMonitor.logComplete(activityId, 200);
		else activityMonitor.logError(activityId, "clone failed");
		return cachedResult;
	}
	const clonePromise = cloneRepo(owner, repo, info.ref, config, signal);
	const localPath = cloneDir(config, owner, repo, info.ref);
	cloneCache.set(key, {
		localPath,
		clonePromise
	});
	const result = await clonePromise;
	if (signal?.aborted) {
		if (!result) cloneCache.delete(key);
		activityMonitor.logComplete(activityId, 0);
		return null;
	}
	if (!result) {
		cloneCache.delete(key);
		if (signal?.aborted) {
			activityMonitor.logComplete(activityId, 0);
			return null;
		}
		const apiFallback = await fetchViaApi(url, owner, repo, info);
		if (apiFallback) {
			activityMonitor.logComplete(activityId, 200);
			return apiFallback;
		}
		activityMonitor.logError(activityId, "clone and API fallback failed");
		return null;
	}
	activityMonitor.logComplete(activityId, 200);
	const content = generateContent(result, info);
	return {
		url,
		title: info.path ? `${owner}/${repo} - ${info.path}` : `${owner}/${repo}`,
		content,
		error: null
	};
}
function clearCloneCache() {
	for (const entry of cloneCache.values()) try {
		rmSync(entry.localPath, {
			recursive: true,
			force: true
		});
	} catch {}
	cloneCache.clear();
	cachedConfig = null;
}
//#endregion
export { clearCloneCache, extractGitHub, parseGitHubUrl };

//# sourceMappingURL=github-extract-Bi0A2_H3.mjs.map