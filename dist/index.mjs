import { n as getWebSearchConfigDir, r as getWebSearchConfigPath, t as formatSeconds } from "./utils-_BNFawOs.mjs";
import { t as activityMonitor } from "./activity-Y0iQoAlM.mjs";
import { n as isBrowserCookieAccessAllowed } from "./gemini-web-config-CY7C6UkR.mjs";
import { n as modelMatchesEnabledPatterns, t as loadEnabledModelPatterns } from "./summary-model-scope-g2To0B58.mjs";
import { createRequire } from "node:module";
import { Box, Text, truncateToWidth } from "@earendil-works/pi-tui";
import { Type } from "typebox";
import { StringEnum, complete } from "@earendil-works/pi-ai/compat";
import { platform } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
//#region fetch-params.ts
function normalizeFetchContentParams(params) {
	const normalizedUrls = uniqueUrls(normalizeUrlArray(params.urls));
	const urlList = normalizedUrls.length > 0 ? normalizedUrls : normalizeSingleUrl(params.url);
	const prompt = normalizeOptionalString(params.prompt);
	const timestamp = normalizeOptionalString(params.timestamp);
	const frames = normalizeOptionalInteger(params.frames);
	const shouldIncludeFrames = frames !== void 0 && (timestamp !== void 0 || frames > 1);
	return {
		urlList,
		options: {
			forceClone: typeof params.forceClone === "boolean" ? params.forceClone : void 0,
			prompt,
			timestamp,
			frames: shouldIncludeFrames ? frames : void 0,
			model: normalizeOptionalString(params.model)
		}
	};
}
function normalizeUrlArray(value) {
	if (!Array.isArray(value)) return [];
	return value.flatMap(normalizeSingleUrl);
}
function normalizeSingleUrl(value) {
	if (typeof value !== "string") return [];
	const trimmed = value.trim();
	return trimmed ? [trimmed] : [];
}
function normalizeOptionalString(value) {
	if (typeof value !== "string") return void 0;
	return value.trim() || void 0;
}
function normalizeOptionalInteger(value) {
	if (typeof value !== "number" || !Number.isInteger(value) || value < 1) return void 0;
	return value;
}
function uniqueUrls(urls) {
	return [...new Set(urls)];
}
//#endregion
//#region storage.ts
const CACHE_TTL_MS = 3600 * 1e3;
const storedResults = /* @__PURE__ */ new Map();
function generateId() {
	return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}
function storeResult(id, data) {
	storedResults.set(id, data);
}
function getResult(id) {
	return storedResults.get(id) ?? null;
}
function getAllResults() {
	return Array.from(storedResults.values());
}
function deleteResult(id) {
	return storedResults.delete(id);
}
function clearResults() {
	storedResults.clear();
}
function isValidStoredData(data) {
	if (!data || typeof data !== "object") return false;
	const d = data;
	if (typeof d.id !== "string" || !d.id) return false;
	if (d.type !== "search" && d.type !== "fetch") return false;
	if (typeof d.timestamp !== "number") return false;
	if (d.type === "search" && !Array.isArray(d.queries)) return false;
	if (d.type === "fetch" && !Array.isArray(d.urls)) return false;
	return true;
}
function restoreFromSession(ctx) {
	storedResults.clear();
	const now = Date.now();
	for (const entry of ctx.sessionManager.getBranch()) if (entry.type === "custom" && entry.customType === "web-search-results") {
		const data = entry.data;
		if (isValidStoredData(data) && now - data.timestamp < CACHE_TTL_MS) storedResults.set(data.id, data);
	}
}
//#endregion
//#region load-modules.ts
let extractMod;
let githubExtractMod;
let curatorServerMod;
let summaryReviewMod;
let geminiSearchMod;
let geminiWebMod;
let providerAvailabilityMod;
function loadExtract() {
	return extractMod ??= import("./extract-BEAF-bqd.mjs");
}
function loadGithubExtract() {
	return githubExtractMod ??= import("./github-extract-Bi0A2_H3.mjs");
}
function loadCuratorServer() {
	return curatorServerMod ??= import("./curator-server-eVysK59J.mjs");
}
function loadSummaryReview() {
	return summaryReviewMod ??= import("./summary-review-BBpO-P57.mjs");
}
function loadGeminiSearch() {
	return geminiSearchMod ??= import("./gemini-search-DU8ECBaV.mjs");
}
function loadGeminiWeb() {
	return geminiWebMod ??= import("./gemini-web-BcCxdxzO.mjs");
}
function loadProviderAvailability() {
	return providerAvailabilityMod ??= import("./provider-availability-Db1qZlbR.mjs");
}
//#endregion
//#region render-search-error.ts
function truncate(text, max) {
	return text.length > max ? text.slice(0, max - 1) + "…" : text;
}
/**
* Build the error/cancel render plan. Returns null when `details` carries no
* error/cancel signal (so the caller falls through to the normal success renderer).
*/
function buildSearchErrorPlan(details) {
	if (!details || !details.error && !details.cancelled) return null;
	const headline = details.error ?? "Search cancelled.";
	const queries = details.cancelledQueries ?? [];
	const queryCount = typeof details.queryCount === "number" && details.queryCount > 0 ? details.queryCount : queries.length;
	const done = queries.length;
	const errored = queries.filter((q) => q.error).length;
	const extras = details.extraLines ?? [];
	if (!(details.cancelled === true || queries.length > 0 || extras.length > 0)) return {
		expanded: [headline],
		collapsed: [],
		expandHint: null
	};
	const expanded = [headline, ""];
	if (details.cancelled === true || queries.length > 0) {
		const diag = [];
		if (details.cancelled) diag.push(`cancel reason   : ${details.cancelReason ?? "unknown"}`);
		const browserLabel = details.browserConnected === void 0 ? "unknown" : details.browserConnected ? "connected" : "never connected";
		diag.push(`browser         : ${browserLabel}`);
		if (typeof details.lastHeartbeatAgeMs === "number" && Number.isFinite(details.lastHeartbeatAgeMs)) diag.push(`last heartbeat  : ${Math.round(details.lastHeartbeatAgeMs / 1e3)}s ago`);
		if (queryCount > 0) {
			diag.push(`queries started : ${queryCount}`);
			diag.push(`queries done    : ${done}`);
			if (errored > 0) diag.push(`queries errored : ${errored}`);
		}
		expanded.push("Diagnostics:");
		for (const line of diag) expanded.push(`  ${line}`);
	}
	if (queries.length > 0) {
		expanded.push("");
		expanded.push("Per-query results (gathered before cancel):");
		for (const q of queries) {
			const dq = truncate(q.query, 52);
			const tag = q.error ? "[err] " : "[ok]  ";
			const provider = q.provider ? ` (${q.provider})` : "";
			const tail = q.error ? `\u2014 ${truncate(q.error, 60)}` : `\u2014 ${q.resultCount} source${q.resultCount === 1 ? "" : "s"}`;
			expanded.push(`  ${tag}"${dq}"${provider} ${tail}`);
		}
	}
	if (extras.length > 0) {
		expanded.push("");
		expanded.push("Details:");
		for (const e of extras) expanded.push(`  ${e}`);
	}
	const collapsed = [];
	const parts = [];
	if (queryCount > 0) parts.push(`${done}/${queryCount} queries completed`);
	if (errored > 0) parts.push(`${errored} errored`);
	if (details.browserConnected === false) parts.push("browser never connected");
	else if (details.cancelReason) parts.push(`reason: ${details.cancelReason}`);
	if (parts.length > 0) collapsed.push(parts.join("; ") + ".");
	if (collapsed.length === 0 && extras.length > 0) for (const e of extras.slice(0, 2)) collapsed.push(truncate(e, 100));
	const hiddenLines = Math.max(0, expanded.length - (1 + collapsed.length));
	return {
		expanded,
		collapsed,
		expandHint: hiddenLines > 0 ? `... (${hiddenLines} more lines, ${expanded.length} total, ctrl+o to expand)` : null
	};
}
//#endregion
//#region index.ts
const WEB_SEARCH_CONFIG_PATH = getWebSearchConfigPath();
/** Shared collapsed/expanded renderer for an error/cancel plan produced by
* buildSearchErrorPlan(). Used by every tool renderResult's error branch so
* Ctrl+O (app.tools.expand) reveals diagnostics instead of a dead-end single line. */
function renderSearchErrorPlan(plan, expanded, theme) {
	if (expanded) return new Text(plan.expanded.map((l, i) => i === 0 ? theme.fg("error", l) : theme.fg("toolOutput", l)).join("\n"), 0, 0);
	const box = new Box(1, 0, (t) => theme.bg("toolErrorBg", t));
	box.addChild(new Text(theme.fg("error", plan.expanded[0]), 0, 0));
	for (const line of plan.collapsed) box.addChild(new Text(theme.fg("dim", line), 0, 0));
	if (plan.expandHint) box.addChild(new Text(theme.fg("muted", plan.expandHint), 0, 0));
	return box;
}
function loadConfig() {
	if (!existsSync(WEB_SEARCH_CONFIG_PATH)) return {};
	const raw = readFileSync(WEB_SEARCH_CONFIG_PATH, "utf-8");
	try {
		return JSON.parse(raw);
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		throw new Error(`Failed to parse ${WEB_SEARCH_CONFIG_PATH}: ${message}`);
	}
}
function saveConfig(updates) {
	let config = {};
	if (existsSync(WEB_SEARCH_CONFIG_PATH)) {
		const raw = readFileSync(WEB_SEARCH_CONFIG_PATH, "utf-8");
		try {
			config = JSON.parse(raw);
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
			throw new Error(`Failed to parse ${WEB_SEARCH_CONFIG_PATH}: ${message}`);
		}
	}
	Object.assign(config, updates);
	const dir = getWebSearchConfigDir();
	if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
	writeFileSync(WEB_SEARCH_CONFIG_PATH, JSON.stringify(config, null, 2) + "\n");
}
const DEFAULT_SHORTCUTS = {
	curate: "ctrl+shift+s",
	activity: "ctrl+shift+w"
};
const DEFAULT_CURATOR_TIMEOUT_SECONDS = 20;
const MAX_CURATOR_TIMEOUT_SECONDS = 600;
function loadConfigForExtensionInit() {
	try {
		return loadConfig();
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		console.error(`[pi-web-access] ${message}`);
		return {};
	}
}
function normalizeProviderInput(value) {
	if (value === void 0) return void 0;
	if (typeof value !== "string") return "auto";
	const normalized = value.trim().toLowerCase();
	return [
		"auto",
		"openai",
		"brave",
		"parallel",
		"tavily",
		"exa",
		"perplexity",
		"gemini"
	].includes(normalized) ? normalized : "auto";
}
function normalizeCuratorTimeoutSeconds(value) {
	if (typeof value !== "number" || !Number.isFinite(value)) return void 0;
	const normalized = Math.floor(value);
	if (normalized < 1) return void 0;
	return Math.min(normalized, MAX_CURATOR_TIMEOUT_SECONDS);
}
function resolveWorkflow(input, hasUI) {
	const normalized = typeof input === "string" ? input.trim().toLowerCase() : "";
	if (normalized === "auto-summary") return "auto-summary";
	if (!hasUI) return "none";
	if (normalized === "none") return "none";
	return "summary-review";
}
function normalizeQueryList(queryList) {
	const normalized = [];
	for (const query of queryList) {
		if (typeof query !== "string") continue;
		const trimmed = query.trim();
		if (trimmed.length > 0) normalized.push(trimmed);
	}
	return normalized;
}
function getCuratorTimeoutSeconds() {
	return normalizeCuratorTimeoutSeconds(loadConfig().curatorTimeoutSeconds) ?? DEFAULT_CURATOR_TIMEOUT_SECONDS;
}
async function getProviderAvailability(ctx) {
	const { getProviderAvailability: probe } = await loadProviderAvailability();
	return probe(ctx);
}
function shouldPreferOpenAI(options) {
	if (!options) return true;
	if (options.recencyFilter) return false;
	if (typeof options.numResults === "number" && Number.isFinite(options.numResults) && Math.floor(options.numResults) !== 5) return false;
	return true;
}
async function loadCuratorBootstrap(requestedProvider, ctx, options) {
	const availableProviders = await getProviderAvailability(ctx);
	return {
		availableProviders,
		defaultProvider: resolveProvider(requestedProvider, availableProviders, options),
		timeoutSeconds: getCuratorTimeoutSeconds()
	};
}
function firstAvailableProvider(available, preferOpenAI, fallback) {
	if (preferOpenAI && available.openai) return "openai";
	if (available.exa) return "exa";
	if (available.brave) return "brave";
	if (available.parallel) return "parallel";
	if (available.tavily) return "tavily";
	if (available.perplexity) return "perplexity";
	if (available.gemini) return "gemini";
	return fallback;
}
function resolveProvider(requested, available, options) {
	const provider = normalizeProviderInput(requested ?? loadConfig().provider ?? "auto") ?? "auto";
	const preferOpenAI = shouldPreferOpenAI(options);
	if (provider === "auto") return firstAvailableProvider(available, preferOpenAI, "exa");
	if (provider === "openai" && !available.openai) return firstAvailableProvider(available, false, "openai");
	if (provider === "brave" && !available.brave) return firstAvailableProvider(available, preferOpenAI, "brave");
	if (provider === "parallel" && !available.parallel) return firstAvailableProvider(available, preferOpenAI, "parallel");
	if (provider === "tavily" && !available.tavily) return firstAvailableProvider(available, preferOpenAI, "tavily");
	if (provider === "exa" && !available.exa) return firstAvailableProvider(available, preferOpenAI, "exa");
	if (provider === "perplexity" && !available.perplexity) return firstAvailableProvider(available, preferOpenAI, "perplexity");
	if (provider === "gemini" && !available.gemini) return firstAvailableProvider(available, preferOpenAI, "gemini");
	return provider;
}
const pendingFetches = /* @__PURE__ */ new Map();
let sessionActive = false;
let widgetVisible = false;
let widgetUnsubscribe = null;
const pendingCurates = /* @__PURE__ */ new Map();
const activeCurators = /* @__PURE__ */ new Map();
const glimpseWins = /* @__PURE__ */ new Map();
const MAX_INLINE_CONTENT = 3e4;
function stripThumbnails(results) {
	return results.map(({ thumbnail, frames, ...rest }) => rest);
}
function formatSearchSummary(results, answer) {
	let output = answer ? `${answer}\n\n---\n\n**Sources:**\n` : "";
	output += results.map((r, i) => `${i + 1}. ${r.title}\n   ${r.url}`).join("\n\n");
	return output;
}
function duplicateQuerySet(results) {
	const counts = /* @__PURE__ */ new Map();
	for (const result of results) counts.set(result.query, (counts.get(result.query) ?? 0) + 1);
	const duplicates = /* @__PURE__ */ new Set();
	for (const [query, count] of counts) if (count > 1) duplicates.add(query);
	return duplicates;
}
function formatQueryHeader(query, provider, duplicateQueries) {
	return `## Query: "${query}"${duplicateQueries.has(query) && provider ? ` (${provider})` : ""}\n\n`;
}
function hasFullInlineCoverage(urls, inlineContent) {
	if (!inlineContent || inlineContent.length === 0) return false;
	const coveredUrls = new Set(inlineContent.map((c) => c.url));
	return urls.every((url) => coveredUrls.has(url));
}
function formatFullResults(queryData) {
	let output = `## Results for: "${queryData.query}"\n\n`;
	if (queryData.answer) output += `${queryData.answer}\n\n---\n\n`;
	for (const r of queryData.results) output += `### ${r.title}\n${r.url}\n\n`;
	return output;
}
function abortPendingFetches() {
	for (const controller of pendingFetches.values()) controller.abort();
	pendingFetches.clear();
}
function closeCurator(callId) {
	if (callId !== void 0) {
		const win = glimpseWins.get(callId);
		glimpseWins.delete(callId);
		try {
			win?.close();
		} catch {}
		pendingCurates.get(callId)?.cancel("stale");
		pendingCurates.delete(callId);
		const curator = activeCurators.get(callId);
		activeCurators.delete(callId);
		try {
			curator?.close();
		} catch {}
		return;
	}
	for (const win of glimpseWins.values()) try {
		win.close();
	} catch {}
	glimpseWins.clear();
	for (const pc of pendingCurates.values()) try {
		pc.cancel("stale");
	} catch {}
	pendingCurates.clear();
	for (const curator of activeCurators.values()) try {
		curator.close();
	} catch {}
	activeCurators.clear();
}
async function openInBrowser(pi, url) {
	const plat = platform();
	const result = plat === "darwin" ? await pi.exec("open", [url]) : plat === "win32" ? await pi.exec("cmd", [
		"/c",
		"start",
		"",
		url
	]) : await pi.exec("xdg-open", [url]);
	if (result.code !== 0) throw new Error(result.stderr || `Failed to open browser (exit code ${result.code})`);
}
let glimpseOpen;
function findGlimpseMjs() {
	try {
		return createRequire(import.meta.url).resolve("glimpseui");
	} catch {}
	try {
		const entry = join(execFileSync("npm", ["root", "-g"], { encoding: "utf-8" }).trim(), "glimpseui", "src", "glimpse.mjs");
		if (existsSync(entry)) return entry;
	} catch {}
	return null;
}
async function getGlimpseOpen() {
	if (glimpseOpen !== void 0) return glimpseOpen;
	const resolved = findGlimpseMjs();
	if (resolved) try {
		glimpseOpen = (await import(resolved)).open;
		return glimpseOpen;
	} catch {}
	glimpseOpen = null;
	return glimpseOpen;
}
function openInGlimpse(open, url, title) {
	const win = open(`<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"><title>${title}</title></head>
<body style="margin:0; background:#1a1a2e;">
  <script>window.location.replace(${JSON.stringify(url)});<\/script>
</body>
</html>`, {
		width: 800,
		height: 900,
		title
	});
	let maxHeight = 1200;
	win.on("ready", (info) => {
		const visibleHeight = info?.screen?.visibleHeight;
		if (typeof visibleHeight === "number" && visibleHeight > 0) maxHeight = Math.floor(visibleHeight * .85);
	});
	win.on("message", (data) => {
		if (!data || typeof data !== "object") return;
		const msg = data;
		if (msg.type !== "resize" || typeof msg.height !== "number") return;
		const clamped = Math.max(400, Math.min(Math.round(msg.height), maxHeight));
		win._write({
			type: "resize",
			width: 800,
			height: clamped
		});
	});
	return win;
}
function extractDomain(url) {
	try {
		return new URL(url).hostname;
	} catch {
		return url;
	}
}
function updateWidget(ctx) {
	const theme = ctx.ui.theme;
	const entries = activityMonitor.getEntries();
	const lines = [];
	lines.push(theme.fg("accent", "─── Web Search Activity " + "─".repeat(36)));
	if (entries.length === 0) lines.push(theme.fg("muted", "  No activity yet"));
	else for (const e of entries) lines.push("  " + formatEntryLine(e, theme));
	lines.push(theme.fg("accent", "─".repeat(60)));
	const rateInfo = activityMonitor.getRateLimitInfo();
	const resetMs = rateInfo.oldestTimestamp ? Math.max(0, rateInfo.oldestTimestamp + rateInfo.windowMs - Date.now()) : 0;
	const resetSec = Math.ceil(resetMs / 1e3);
	lines.push(theme.fg("muted", `Rate: ${rateInfo.used}/${rateInfo.max}`) + (resetMs > 0 ? theme.fg("dim", ` (resets in ${resetSec}s)`) : ""));
	ctx.ui.setWidget("web-activity", new Text(lines.join("\n"), 0, 0));
}
function formatEntryLine(entry, theme) {
	const typeStr = entry.type === "api" ? "API" : "GET";
	const target = entry.type === "api" ? `"${truncateToWidth(entry.query || "", 28, "")}"` : truncateToWidth(entry.url?.replace(/^https?:\/\//, "") || "", 30, "");
	const duration = entry.endTime ? `${((entry.endTime - entry.startTime) / 1e3).toFixed(1)}s` : `${((Date.now() - entry.startTime) / 1e3).toFixed(1)}s`;
	let statusStr;
	let indicator;
	if (entry.error) {
		statusStr = "err";
		indicator = theme.fg("error", "✗");
	} else if (entry.status === null) {
		statusStr = "...";
		indicator = theme.fg("warning", "⋯");
	} else if (entry.status === 0) {
		statusStr = "abort";
		indicator = theme.fg("muted", "○");
	} else {
		statusStr = String(entry.status);
		indicator = entry.status >= 200 && entry.status < 300 ? theme.fg("success", "✓") : theme.fg("error", "✗");
	}
	return `${typeStr.padEnd(4)} ${target.padEnd(32)} ${statusStr.padStart(5)} ${duration.padStart(5)} ${indicator}`;
}
function handleSessionChange(ctx) {
	abortPendingFetches();
	closeCurator();
	loadGithubExtract().then((m) => m.clearCloneCache()).catch(() => {});
	sessionActive = true;
	restoreFromSession(ctx);
	widgetUnsubscribe?.();
	widgetUnsubscribe = null;
	activityMonitor.clear();
	if (widgetVisible) {
		widgetUnsubscribe = activityMonitor.onUpdate(() => updateWidget(ctx));
		updateWidget(ctx);
	}
}
function cold_start_lazy_import_default(pi) {
	const initConfig = loadConfigForExtensionInit();
	const curateKey = initConfig.shortcuts?.curate || DEFAULT_SHORTCUTS.curate;
	const activityKey = initConfig.shortcuts?.activity || DEFAULT_SHORTCUTS.activity;
	function startBackgroundFetch(urls) {
		if (urls.length === 0) return null;
		const fetchId = generateId();
		const controller = new AbortController();
		pendingFetches.set(fetchId, controller);
		loadExtract().then(({ fetchAllContent }) => fetchAllContent(urls, controller.signal)).then((fetched) => {
			if (!sessionActive || !pendingFetches.has(fetchId)) return;
			const data = {
				id: fetchId,
				type: "fetch",
				timestamp: Date.now(),
				urls: stripThumbnails(fetched)
			};
			storeResult(fetchId, data);
			pi.appendEntry("web-search-results", data);
			const ok = fetched.filter((f) => !f.error).length;
			pi.sendMessage({
				customType: "web-search-content-ready",
				content: `Content fetched for ${ok}/${fetched.length} URLs [${fetchId}]. Full page content now available.`,
				display: true
			}, { triggerTurn: true });
		}).catch((err) => {
			if (!sessionActive || !pendingFetches.has(fetchId)) return;
			const message = err instanceof Error ? err.message : String(err);
			if (!(err instanceof Error && err.name === "AbortError" || message.toLowerCase().includes("abort"))) pi.sendMessage({
				customType: "web-search-error",
				content: `Content fetch failed [${fetchId}]: ${message}`,
				display: true
			}, { triggerTurn: false });
		}).finally(() => {
			pendingFetches.delete(fetchId);
		});
		return fetchId;
	}
	function storeAndPublishSearch(results) {
		const id = generateId();
		const data = {
			id,
			type: "search",
			timestamp: Date.now(),
			queries: results
		};
		storeResult(id, data);
		pi.appendEntry("web-search-results", data);
		return id;
	}
	function normalizeSummaryMeta(meta, summaryText) {
		const normalizedText = summaryText.trim();
		if (!meta) return {
			model: null,
			durationMs: 0,
			tokenEstimate: normalizedText.length > 0 ? Math.max(1, Math.ceil(normalizedText.length / 4)) : 0,
			fallbackUsed: false,
			edited: false
		};
		return {
			model: meta.model,
			durationMs: Number.isFinite(meta.durationMs) && meta.durationMs >= 0 ? meta.durationMs : 0,
			tokenEstimate: Number.isFinite(meta.tokenEstimate) && meta.tokenEstimate >= 0 ? meta.tokenEstimate : normalizedText.length > 0 ? Math.max(1, Math.ceil(normalizedText.length / 4)) : 0,
			fallbackUsed: meta.fallbackUsed === true,
			fallbackReason: meta.fallbackReason,
			edited: meta.edited === true
		};
	}
	function buildCurationCancelledReturn(reason, partial) {
		const message = `Search curation cancelled (${reason}).`;
		const cancelledQueries = partial?.queries?.length ? partial.queries.map((q) => ({
			query: q.query,
			provider: q.provider ?? null,
			error: q.error,
			resultCount: q.results?.length ?? 0
		})) : void 0;
		const extraLines = [];
		if (partial?.curatorUrl) extraLines.push(`curator: ${partial.curatorUrl}`);
		if (partial?.browserOpenError) extraLines.push(`browser open error: ${partial.browserOpenError}`);
		return {
			content: [{
				type: "text",
				text: message
			}],
			details: {
				error: message,
				cancelled: true,
				cancelReason: reason,
				browserConnected: partial?.browserConnected,
				lastHeartbeatAgeMs: partial?.lastHeartbeatAgeMs,
				queryCount: partial?.queryCount,
				cancelledQueries,
				extraLines: extraLines.length > 0 ? extraLines : void 0
			}
		};
	}
	async function resolveFirstAvailableModel(ctx, candidates) {
		const enabledModelPatterns = loadEnabledModelPatterns(ctx);
		for (const { provider, id } of candidates) {
			const model = ctx.modelRegistry.find(provider, id);
			if (!model || !modelMatchesEnabledPatterns(model, enabledModelPatterns)) continue;
			const auth = await ctx.modelRegistry.getApiKeyAndHeaders(model);
			if (auth.ok && auth.apiKey) return {
				model,
				apiKey: auth.apiKey,
				headers: auth.headers
			};
		}
		throw new Error(`No enabled model available: ${candidates.map((c) => `${c.provider}/${c.id}`).join(", ")}`);
	}
	async function rewriteSearchQuery(query, ctx, signal) {
		const { model, apiKey, headers } = await resolveFirstAvailableModel(ctx, [
			{
				provider: "anthropic",
				id: "claude-haiku-4-5"
			},
			{
				provider: "google",
				id: "gemini-2.5-flash"
			},
			{
				provider: "openai",
				id: "gpt-4.1-mini"
			}
		]);
		const response = await complete(model, { messages: [{
			role: "user",
			content: [{
				type: "text",
				text: `Rewrite this web search query to get better, more specific results. Add relevant year qualifiers, precise technical terms, and specificity. Return ONLY the improved query text, nothing else.\n\nQuery: ${query}`
			}],
			timestamp: Date.now()
		}] }, {
			apiKey,
			headers,
			signal
		});
		if (response.stopReason === "aborted") throw new Error("Aborted");
		const text = (Array.isArray(response.content) ? response.content : []).map((p) => {
			if (!p || typeof p !== "object") return "";
			const part = p;
			return typeof part.text === "string" ? part.text : "";
		}).join("").trim();
		if (!text) throw new Error("Rewrite returned empty response");
		return text;
	}
	async function generateSummaryForSelectedIndices(selectedQueryIndices, resultsByIndex, summaryContext, signal, modelOverride, feedback) {
		const selectedResults = [];
		for (const qi of selectedQueryIndices) {
			const result = resultsByIndex.get(qi);
			if (result) selectedResults.push(result);
		}
		if (selectedResults.length === 0) throw new Error("No selected results available for summary generation");
		const { generateSummaryDraft, buildDeterministicSummary } = await loadSummaryReview();
		try {
			return await generateSummaryDraft(selectedResults, summaryContext, signal, modelOverride, feedback);
		} catch (err) {
			if (!(err instanceof Error && err.message.includes("Summary model returned empty response"))) throw err;
			const deterministic = buildDeterministicSummary(selectedResults);
			return {
				summary: deterministic.summary,
				meta: {
					...deterministic.meta,
					fallbackReason: "summary-model-empty-response"
				}
			};
		}
	}
	async function loadSummaryModelChoices(summaryContext) {
		const summaryModels = [];
		const seen = /* @__PURE__ */ new Set();
		const availableValues = /* @__PURE__ */ new Set();
		const addModel = (provider, id) => {
			const value = `${provider}/${id}`;
			if (seen.has(value)) return;
			seen.add(value);
			summaryModels.push({
				value,
				label: value
			});
		};
		let enabledModelPatterns = null;
		let scopeLoaded = true;
		try {
			enabledModelPatterns = loadEnabledModelPatterns(summaryContext);
			const availableModels = summaryContext.modelRegistry.getAvailable();
			for (const model of availableModels) {
				if (!modelMatchesEnabledPatterns(model, enabledModelPatterns)) continue;
				const value = `${model.provider}/${model.id}`;
				availableValues.add(value);
				addModel(model.provider, model.id);
			}
		} catch (err) {
			scopeLoaded = false;
			const message = err instanceof Error ? err.message : String(err);
			console.error(`Failed to load summary models: ${message}`);
		}
		const currentModelValue = summaryContext.model ? `${summaryContext.model.provider}/${summaryContext.model.id}` : null;
		if (scopeLoaded && summaryContext.model && currentModelValue && !seen.has(currentModelValue) && modelMatchesEnabledPatterns(summaryContext.model, enabledModelPatterns)) addModel(summaryContext.model.provider, summaryContext.model.id);
		const config = loadConfig();
		const configuredSummaryModel = typeof config.summaryModel === "string" ? config.summaryModel.trim() : "";
		const preferredDefaults = ["anthropic/claude-haiku-4-5", "openai-codex/gpt-5.3-codex-spark"];
		let defaultSummaryModel = null;
		if (configuredSummaryModel.length > 0 && availableValues.has(configuredSummaryModel)) defaultSummaryModel = configuredSummaryModel;
		if (!defaultSummaryModel) {
			for (const preferred of preferredDefaults) if (availableValues.has(preferred)) {
				defaultSummaryModel = preferred;
				break;
			}
		}
		return {
			summaryModels,
			defaultSummaryModel
		};
	}
	async function resolveSummaryForSubmit(payload, resultsByIndex) {
		const submittedSummary = typeof payload.summary === "string" ? payload.summary.trim() : "";
		if (submittedSummary.length > 0) return {
			approvedSummary: submittedSummary,
			summaryMeta: normalizeSummaryMeta(payload.summaryMeta, submittedSummary)
		};
		const selected = filterByQueryIndices(payload.selectedQueryIndices, resultsByIndex).results;
		const fallbackResults = selected.length > 0 ? selected : [...resultsByIndex.values()];
		const { buildDeterministicSummary } = await loadSummaryReview();
		const deterministic = buildDeterministicSummary(fallbackResults);
		return {
			approvedSummary: deterministic.summary,
			summaryMeta: deterministic.meta
		};
	}
	function buildSearchReturn(opts) {
		const sc = opts.results.filter((r) => !r.error).length;
		const tr = opts.results.reduce((sum, r) => sum + r.results.length, 0);
		const hasApprovedSummary = typeof opts.approvedSummary === "string" && opts.approvedSummary.trim().length > 0;
		let output = "";
		if (hasApprovedSummary) output = opts.approvedSummary.trim();
		else {
			if (opts.curated) output += "[These results were manually curated by the user in the browser. Use them as-is — do not re-search or discard.]\n\n";
			const duplicateQueries = opts.curated ? duplicateQuerySet(opts.results) : /* @__PURE__ */ new Set();
			for (const { query, answer, results, error, provider } of opts.results) {
				if (opts.queryList.length > 1) output += opts.curated ? formatQueryHeader(query, provider, duplicateQueries) : `## Query: "${query}"\n\n`;
				if (error) output += `Error: ${error}\n\n`;
				else if (results.length === 0) output += "No results found.\n\n";
				else output += formatSearchSummary(results, answer) + "\n\n";
			}
		}
		const hasInlineReady = hasFullInlineCoverage(opts.urls, opts.inlineContent);
		let fetchId = null;
		if (hasInlineReady && opts.inlineContent) {
			fetchId = generateId();
			const data = {
				id: fetchId,
				type: "fetch",
				timestamp: Date.now(),
				urls: opts.inlineContent
			};
			storeResult(fetchId, data);
			pi.appendEntry("web-search-results", data);
			if (!hasApprovedSummary) output += `---\nFull content for ${opts.inlineContent.length} sources available [${fetchId}].`;
		} else if (opts.includeContent) {
			fetchId = startBackgroundFetch(opts.urls);
			if (fetchId && !hasApprovedSummary) output += `---\nContent fetching in background [${fetchId}]. Will notify when ready.`;
		}
		const searchId = storeAndPublishSearch(opts.results);
		const isBackgroundFetch = fetchId !== null && !hasInlineReady;
		return {
			content: [{
				type: "text",
				text: output.trim()
			}],
			details: {
				queries: opts.queryList,
				queryCount: opts.queryList.length,
				successfulQueries: sc,
				totalResults: tr,
				includeContent: opts.includeContent,
				fetchId,
				fetchUrls: isBackgroundFetch ? opts.urls : void 0,
				searchId,
				...opts.curated ? {
					curated: true,
					curatedFrom: opts.curatedFrom,
					curatedQueries: opts.results.map((r) => ({
						query: r.query,
						provider: r.provider || null,
						answer: r.answer || null,
						sources: r.results.map((s) => ({
							title: s.title,
							url: s.url
						})),
						error: r.error
					}))
				} : {},
				...opts.workflow && hasApprovedSummary ? { summary: {
					text: opts.approvedSummary.trim(),
					workflow: opts.workflow,
					model: opts.summaryMeta?.model ?? null,
					durationMs: opts.summaryMeta?.durationMs ?? 0,
					tokenEstimate: opts.summaryMeta?.tokenEstimate ?? 0,
					fallbackUsed: opts.summaryMeta?.fallbackUsed === true,
					fallbackReason: opts.summaryMeta?.fallbackReason,
					edited: opts.summaryMeta?.edited === true
				} } : {}
			}
		};
	}
	function filterByQueryIndices(selectedQueryIndices, results) {
		const filteredResults = [];
		const filteredUrls = [];
		for (const qi of selectedQueryIndices) {
			const r = results.get(qi);
			if (r) {
				filteredResults.push(r);
				for (const res of r.results) if (!filteredUrls.includes(res.url)) filteredUrls.push(res.url);
			}
		}
		return {
			results: filteredResults,
			urls: filteredUrls
		};
	}
	function collectAllResultsAndUrls(resultsByIndex) {
		const results = [...resultsByIndex.values()];
		const urls = [];
		for (const result of results) for (const source of result.results) if (!urls.includes(source.url)) urls.push(source.url);
		return {
			results,
			urls
		};
	}
	async function openCuratorBrowser(callId, pc, searchesComplete = true) {
		if (pendingCurates.get(callId) !== pc) return;
		let handle = null;
		try {
			pc.phase = "curating";
			const searchAbort = new AbortController();
			const addSearchSignal = pc.signal ? AbortSignal.any([pc.signal, searchAbort.signal]) : searchAbort.signal;
			const sessionToken = randomUUID();
			handle = await (await loadCuratorServer()).startCuratorServer({
				queries: pc.queryList,
				sessionToken,
				timeout: pc.timeoutSeconds,
				availableProviders: pc.availableProviders,
				defaultProvider: pc.defaultProvider,
				searchProvider: pc.searchProvider,
				summaryModels: pc.summaryModels,
				defaultSummaryModel: pc.defaultSummaryModel
			}, {
				async onSummarize(selectedQueryIndices, summarizeSignal, model, feedback) {
					if (pendingCurates.get(callId) !== pc) throw new Error("Curator session is no longer active.");
					pc.onUpdate?.({
						content: [{
							type: "text",
							text: "Generating summary draft..."
						}],
						details: {
							phase: "generating-summary",
							progress: .9,
							curatorUrl: pc.curatorUrl,
							timeoutSeconds: pc.timeoutSeconds,
							shortcut: curateKey
						}
					});
					const draft = await generateSummaryForSelectedIndices(selectedQueryIndices, pc.searchResults, pc.summaryContext, summarizeSignal, model, feedback);
					if (pendingCurates.get(callId) !== pc) throw new Error("Curator session is no longer active.");
					pc.onUpdate?.({
						content: [{
							type: "text",
							text: "Summary draft ready — waiting for approval..."
						}],
						details: {
							phase: "waiting-for-approval",
							progress: 1,
							curatorUrl: pc.curatorUrl,
							timeoutSeconds: pc.timeoutSeconds,
							shortcut: curateKey
						}
					});
					return draft;
				},
				async onSubmit(payload) {
					if (pendingCurates.get(callId) !== pc) return;
					searchAbort.abort();
					const filtered = payload.selectedQueryIndices.length > 0 ? filterByQueryIndices(payload.selectedQueryIndices, pc.searchResults) : collectAllResultsAndUrls(pc.searchResults);
					const filteredInline = pc.allInlineContent.filter((c) => filtered.urls.includes(c.url));
					const base = {
						queryList: filtered.results.map((r) => r.query),
						results: filtered.results,
						urls: filtered.urls,
						includeContent: pc.includeContent,
						inlineContent: filteredInline.length > 0 ? filteredInline : void 0,
						curated: true,
						curatedFrom: pc.searchResults.size
					};
					if (!payload.rawResults) {
						const resolvedSummary = await resolveSummaryForSubmit(payload, pc.searchResults);
						base.workflow = pc.workflow;
						base.approvedSummary = resolvedSummary.approvedSummary;
						base.summaryMeta = resolvedSummary.summaryMeta;
					}
					pc.finish(buildSearchReturn(base));
					closeCurator(callId);
				},
				async onCancel(reason) {
					if (pendingCurates.get(callId) !== pc) return;
					searchAbort.abort();
					if (reason === "timeout") {
						const resolvedSummary = await resolveSummaryForSubmit({
							selectedQueryIndices: [],
							summary: void 0,
							summaryMeta: void 0
						}, pc.searchResults);
						const all = collectAllResultsAndUrls(pc.searchResults);
						const filteredInline = pc.allInlineContent.filter((c) => all.urls.includes(c.url));
						pc.finish(buildSearchReturn({
							queryList: all.results.map((r) => r.query),
							results: all.results,
							urls: all.urls,
							includeContent: pc.includeContent,
							inlineContent: filteredInline.length > 0 ? filteredInline : void 0,
							curated: true,
							curatedFrom: pc.searchResults.size,
							workflow: pc.workflow,
							approvedSummary: resolvedSummary.approvedSummary,
							summaryMeta: resolvedSummary.summaryMeta
						}));
					} else {
						const conn = activeCurators.get(callId)?.getConnectionState();
						pc.finish(buildCurationCancelledReturn(reason, {
							queries: Array.from(pc.searchResults.values()),
							queryCount: pc.queryList.length,
							browserConnected: conn?.browserConnected,
							lastHeartbeatAgeMs: conn?.lastHeartbeatAgeMs,
							curatorUrl: pc.curatorUrl,
							browserOpenError: pc.browserOpenError
						}));
					}
					closeCurator(callId);
				},
				onProviderChange(provider) {
					if (pendingCurates.get(callId) !== pc) return;
					const normalized = normalizeProviderInput(provider);
					if (!normalized || normalized === "auto") return;
					pc.defaultProvider = normalized;
					pc.searchProvider = normalized;
					try {
						saveConfig({ provider: normalized });
					} catch (err) {
						const message = err instanceof Error ? err.message : String(err);
						console.error(`Failed to persist default provider: ${message}`);
					}
				},
				async onAddSearch(query, queryIndex, provider) {
					if (pendingCurates.get(callId) !== pc) throw new Error("Curator session is no longer active.");
					const normalizedProvider = normalizeProviderInput(provider);
					const requestedProvider = !normalizedProvider || normalizedProvider === "auto" ? pc.searchProvider : normalizedProvider;
					try {
						const { answer, results, inlineContent, provider: actualProvider } = await (await loadGeminiSearch()).search(query, {
							provider: requestedProvider,
							numResults: pc.numResults,
							recencyFilter: pc.recencyFilter,
							domainFilter: pc.domainFilter,
							includeContent: pc.includeContent,
							signal: addSearchSignal,
							extensionContext: ctx
						});
						if (pendingCurates.get(callId) !== pc) throw new Error("Curator session is no longer active.");
						pc.searchResults.set(queryIndex, {
							query,
							answer,
							results,
							error: null,
							provider: actualProvider
						});
						if (inlineContent) pc.allInlineContent.push(...inlineContent);
						return {
							answer,
							results: results.map((r) => ({
								title: r.title,
								url: r.url,
								domain: extractDomain(r.url)
							})),
							provider: actualProvider
						};
					} catch (err) {
						const message = err instanceof Error ? err.message : String(err);
						if (pendingCurates.get(callId) === pc) pc.searchResults.set(queryIndex, {
							query,
							answer: "",
							results: [],
							error: message,
							provider: requestedProvider
						});
						throw err;
					}
				},
				async onRewriteQuery(query, rewriteSignal) {
					if (pendingCurates.get(callId) !== pc) throw new Error("Curator session is no longer active.");
					return rewriteSearchQuery(query, pc.summaryContext, rewriteSignal);
				}
			});
			if (pendingCurates.get(callId) !== pc) {
				handle.close();
				return;
			}
			activeCurators.set(callId, handle);
			pc.curatorUrl = handle.url;
			for (const [qi, data] of pc.searchResults) if (data.error) handle.pushError(qi, data.error, data.provider);
			else handle.pushResult(qi, {
				answer: data.answer,
				results: data.results.map((r) => ({
					title: r.title,
					url: r.url,
					domain: extractDomain(r.url)
				})),
				provider: data.provider || pc.defaultProvider
			});
			if (searchesComplete) handle.searchesDone();
			pc.onUpdate?.({
				content: [{
					type: "text",
					text: searchesComplete ? "Waiting for summary approval in browser..." : "Searches streaming to browser..."
				}],
				details: {
					phase: "curating",
					progress: searchesComplete ? 1 : .5,
					curatorUrl: handle.url,
					timeoutSeconds: pc.timeoutSeconds,
					shortcut: curateKey
				}
			});
			const open = platform() === "darwin" ? await getGlimpseOpen() : null;
			if (open) try {
				const win = openInGlimpse(open, handle.url, "Search Curator");
				glimpseWins.set(callId, win);
				win.on("closed", () => {
					if (glimpseWins.get(callId) === win) {
						glimpseWins.delete(callId);
						closeCurator(callId);
					}
				});
				return;
			} catch (err) {
				const message = err instanceof Error ? err.message : String(err);
				console.error(`Failed to open Glimpse curator window: ${message}`);
				glimpseWins.delete(callId);
			}
			await openInBrowser(pi, handle.url);
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
			console.error(`Failed to open curator UI: ${message}`);
			if (handle && activeCurators.get(callId) === handle && pendingCurates.get(callId) === pc) {
				pc.browserOpenError = message;
				sendCuratorFallbackUpdate("Search curator is running, but the browser did not open automatically.");
			} else if (pendingCurates.get(callId) === pc || handle && activeCurators.get(callId) === handle) closeCurator(callId);
		}
	}
	pi.registerShortcut(curateKey, {
		description: "Review search results",
		handler: async (ctx) => {
			const entries = [...pendingCurates.entries()];
			if (entries.length === 0) return;
			const [callId, pc] = entries[entries.length - 1];
			if (pc.phase === "searching") {
				pc.browserPromise = openCuratorBrowser(callId, pc, false);
				ctx.ui.notify("Opening curator — remaining searches will stream in", "info");
				return;
			}
		}
	});
	pi.registerShortcut(activityKey, {
		description: "Toggle web search activity",
		handler: async (ctx) => {
			widgetVisible = !widgetVisible;
			if (widgetVisible) {
				widgetUnsubscribe = activityMonitor.onUpdate(() => updateWidget(ctx));
				updateWidget(ctx);
			} else {
				widgetUnsubscribe?.();
				widgetUnsubscribe = null;
				ctx.ui.setWidget("web-activity", void 0);
			}
		}
	});
	pi.on("session_start", async (_event, ctx) => handleSessionChange(ctx));
	pi.on("session_tree", async (_event, ctx) => handleSessionChange(ctx));
	pi.on("session_shutdown", () => {
		sessionActive = false;
		abortPendingFetches();
		closeCurator();
		loadGithubExtract().then((m) => m.clearCloneCache()).catch(() => {});
		clearResults();
		widgetUnsubscribe?.();
		widgetUnsubscribe = null;
		activityMonitor.clear();
		widgetVisible = false;
	});
	if (initConfig.webSearch?.enabled !== false) pi.registerTool({
		name: "web_search",
		label: "Web Search",
		description: `Search the web using OpenAI, Brave, Parallel, Tavily, Exa, Perplexity, or Gemini. Returns an AI-synthesized answer with source citations. OpenAI web_search uses a Codex subscription or OpenAI API key. For comprehensive research, prefer queries (plural) with 2-4 varied angles over a single query — each query gets its own synthesized answer, so varying phrasing and scope gives much broader coverage. When includeContent is true, full page content is fetched in the background. Searches auto-open the interactive browser curator and stream results live; set workflow to "none" to skip curation or "auto-summary" for a model-generated summary without the browser curator. Provider auto-selects: OpenAI when suitable and available, then Exa, Brave, Parallel, Tavily, Perplexity, Gemini API, then Gemini Web.`,
		promptSnippet: "Use for web research questions. Prefer {queries:[...]} with 2-4 varied angles over a single query for broader coverage.",
		parameters: Type.Object({
			query: Type.Optional(Type.String({ description: "Single search query. For research tasks, prefer 'queries' with multiple varied angles instead." })),
			queries: Type.Optional(Type.Array(Type.String(), { description: "Multiple queries searched in sequence, each returning its own synthesized answer. Prefer this for research — vary phrasing, scope, and angle across 2-4 queries to maximize coverage. Good: ['React vs Vue performance benchmarks 2026', 'React vs Vue developer experience comparison', 'React ecosystem size vs Vue ecosystem']. Bad: ['React vs Vue', 'React vs Vue comparison', 'React vs Vue review'] (too similar, redundant results)." })),
			numResults: Type.Optional(Type.Number({ description: "Results per query (default: 5, max: 20)" })),
			includeContent: Type.Optional(Type.Boolean({ description: "Fetch full page content (async)" })),
			recencyFilter: Type.Optional(StringEnum([
				"day",
				"week",
				"month",
				"year"
			], { description: "Filter by recency" })),
			domainFilter: Type.Optional(Type.Array(Type.String(), { description: "Limit to domains (prefix with - to exclude)" })),
			provider: Type.Optional(StringEnum([
				"auto",
				"openai",
				"brave",
				"parallel",
				"tavily",
				"exa",
				"perplexity",
				"gemini"
			], { description: "Search provider (default: auto)" })),
			workflow: Type.Optional(StringEnum([
				"none",
				"summary-review",
				"auto-summary"
			], { description: "Search workflow mode: none = no curator, summary-review = open curator with auto summary draft (default), auto-summary = generate summary without opening curator" }))
		}),
		async execute(callId, params, signal, onUpdate, ctx) {
			const queryList = normalizeQueryList(Array.isArray(params.queries) ? params.queries : params.query !== void 0 ? [params.query] : []);
			const configWorkflow = loadConfigForExtensionInit().workflow;
			const workflow = resolveWorkflow(params.workflow ?? configWorkflow, ctx?.hasUI !== false);
			const shouldCurate = workflow === "summary-review";
			if (queryList.length === 0) return {
				content: [{
					type: "text",
					text: "Error: No query provided. Use 'query' or 'queries' parameter."
				}],
				details: { error: "No query provided" }
			};
			if (shouldCurate && !ctx) return {
				content: [{
					type: "text",
					text: "Error: Curation requires an active extension context."
				}],
				details: { error: "Missing extension context" }
			};
			if (shouldCurate) {
				closeCurator(callId);
				let resolvePromise = () => {};
				const promise = new Promise((resolve) => {
					resolvePromise = resolve;
				});
				const includeContent = params.includeContent ?? false;
				const searchResults = /* @__PURE__ */ new Map();
				const allInlineContent = [];
				const searchAbort = new AbortController();
				const searchSignal = signal ? AbortSignal.any([signal, searchAbort.signal]) : searchAbort.signal;
				let cancelled = false;
				const bootstrap = await loadCuratorBootstrap(params.provider, ctx, {
					numResults: params.numResults,
					recencyFilter: params.recencyFilter
				});
				const availableProviders = bootstrap.availableProviders;
				const defaultProvider = bootstrap.defaultProvider;
				const searchProvider = (normalizeProviderInput(params.provider ?? loadConfig().provider ?? "auto") ?? "auto") === "auto" ? "auto" : defaultProvider;
				const curatorTimeoutSeconds = bootstrap.timeoutSeconds;
				const curatorWorkflow = "summary-review";
				const summaryContext = {
					model: ctx.model,
					modelRegistry: ctx.modelRegistry,
					cwd: ctx.cwd,
					isProjectTrusted: () => ctx.isProjectTrusted()
				};
				const summaryModelChoices = await loadSummaryModelChoices(summaryContext);
				const pc = {
					phase: "searching",
					workflow: curatorWorkflow,
					summaryContext,
					searchResults,
					allInlineContent,
					queryList,
					includeContent,
					numResults: params.numResults,
					recencyFilter: params.recencyFilter,
					domainFilter: params.domainFilter,
					availableProviders,
					defaultProvider,
					searchProvider,
					summaryModels: summaryModelChoices.summaryModels,
					defaultSummaryModel: summaryModelChoices.defaultSummaryModel,
					timeoutSeconds: curatorTimeoutSeconds,
					onUpdate,
					signal,
					abortSearches: () => {
						if (!searchAbort.signal.aborted) searchAbort.abort();
					},
					finish: () => {},
					cancel: () => {}
				};
				const finish = (value) => {
					if (cancelled) return;
					cancelled = true;
					pc.abortSearches();
					signal?.removeEventListener("abort", onAbort);
					pendingCurates.delete(callId);
					resolvePromise(value);
				};
				const cancel = (reason = "stale") => {
					if (cancelled) return;
					const conn = activeCurators.get(callId)?.getConnectionState();
					finish(buildCurationCancelledReturn(reason, {
						queries: Array.from(searchResults.values()),
						queryCount: queryList.length,
						browserConnected: conn?.browserConnected,
						lastHeartbeatAgeMs: conn?.lastHeartbeatAgeMs,
						curatorUrl: pc.curatorUrl,
						browserOpenError: pc.browserOpenError
					}));
				};
				pc.finish = finish;
				pc.cancel = cancel;
				const onAbort = () => closeCurator(callId);
				pendingCurates.set(callId, pc);
				signal?.addEventListener("abort", onAbort, { once: true });
				pc.browserPromise = openCuratorBrowser(callId, pc, false);
				for (let qi = 0; qi < queryList.length; qi++) {
					if (signal?.aborted || cancelled || searchAbort.signal.aborted) break;
					onUpdate?.({
						content: [{
							type: "text",
							text: `Searching ${qi + 1}/${queryList.length}: "${queryList[qi]}"...`
						}],
						details: {
							phase: "searching",
							progress: qi / queryList.length,
							currentQuery: queryList[qi]
						}
					});
					const requestedProvider = pc.searchProvider;
					try {
						const { answer, results, inlineContent, provider } = await (await loadGeminiSearch()).search(queryList[qi], {
							provider: requestedProvider,
							numResults: params.numResults,
							recencyFilter: params.recencyFilter,
							domainFilter: params.domainFilter,
							includeContent: params.includeContent,
							signal: searchSignal,
							extensionContext: ctx
						});
						if (signal?.aborted || cancelled || searchAbort.signal.aborted) break;
						searchResults.set(qi, {
							query: queryList[qi],
							answer,
							results,
							error: null,
							provider
						});
						if (inlineContent) allInlineContent.push(...inlineContent);
						const curator = activeCurators.get(callId);
						if (curator) curator.pushResult(qi, {
							answer,
							results: results.map((r) => ({
								title: r.title,
								url: r.url,
								domain: extractDomain(r.url)
							})),
							provider
						});
					} catch (err) {
						if (signal?.aborted || cancelled || searchAbort.signal.aborted) break;
						const message = err instanceof Error ? err.message : String(err);
						searchResults.set(qi, {
							query: queryList[qi],
							answer: "",
							results: [],
							error: message,
							provider: requestedProvider
						});
						const curator = activeCurators.get(callId);
						if (curator) curator.pushError(qi, message, requestedProvider);
					}
				}
				if (signal?.aborted || cancelled || searchAbort.signal.aborted) {
					cancel();
					return promise;
				}
				await pc.browserPromise;
				const curator = activeCurators.get(callId);
				if (curator && !cancelled) {
					curator.searchesDone();
					if (pc.browserOpenError) pc.onUpdate?.({
						content: [{
							type: "text",
							text: `All searches complete. Open the curator manually: ${pc.curatorUrl}`
						}],
						details: {
							phase: "curator-fallback",
							progress: 1,
							curatorUrl: pc.curatorUrl,
							timeoutSeconds: pc.timeoutSeconds,
							shortcut: curateKey,
							browserOpenError: pc.browserOpenError
						}
					});
					else pc.onUpdate?.({
						content: [{
							type: "text",
							text: "All searches complete — waiting for summary approval in browser..."
						}],
						details: {
							phase: "curating",
							progress: 1,
							curatorUrl: pc.curatorUrl,
							timeoutSeconds: pc.timeoutSeconds,
							shortcut: curateKey
						}
					});
				}
				return promise;
			}
			const searchResults = [];
			const allUrls = [];
			const allInlineContent = [];
			const resolvedProvider = normalizeProviderInput(params.provider ?? loadConfig().provider);
			for (let i = 0; i < queryList.length; i++) {
				const query = queryList[i];
				onUpdate?.({
					content: [{
						type: "text",
						text: `Searching ${i + 1}/${queryList.length}: "${query}"...`
					}],
					details: {
						phase: "search",
						progress: i / queryList.length,
						currentQuery: query
					}
				});
				try {
					const { answer, results, inlineContent, provider } = await (await loadGeminiSearch()).search(query, {
						provider: resolvedProvider,
						numResults: params.numResults,
						recencyFilter: params.recencyFilter,
						domainFilter: params.domainFilter,
						includeContent: params.includeContent,
						signal,
						extensionContext: ctx
					});
					searchResults.push({
						query,
						answer,
						results,
						error: null,
						provider
					});
					for (const r of results) if (!allUrls.includes(r.url)) allUrls.push(r.url);
					if (inlineContent) allInlineContent.push(...inlineContent);
				} catch (err) {
					const message = err instanceof Error ? err.message : String(err);
					const requestedProvider = typeof resolvedProvider === "string" && resolvedProvider !== "auto" ? resolvedProvider : void 0;
					searchResults.push({
						query,
						answer: "",
						results: [],
						error: message,
						provider: requestedProvider
					});
				}
			}
			let approvedSummary;
			let summaryMeta;
			if (workflow === "auto-summary") {
				if (!ctx) return {
					content: [{
						type: "text",
						text: "Error: Auto-summary requires an active extension context."
					}],
					details: { error: "Missing extension context" }
				};
				onUpdate?.({
					content: [{
						type: "text",
						text: "Generating summary..."
					}],
					details: {
						phase: "generating-summary",
						progress: 1
					}
				});
				const summaryContext = {
					model: ctx.model,
					modelRegistry: ctx.modelRegistry,
					cwd: ctx.cwd,
					isProjectTrusted: () => ctx.isProjectTrusted()
				};
				const summaryModelChoices = await loadSummaryModelChoices(summaryContext);
				const { generateSummaryDraft } = await loadSummaryReview();
				const generated = await generateSummaryDraft(searchResults, summaryContext, signal, summaryModelChoices.defaultSummaryModel ?? void 0);
				approvedSummary = generated.summary;
				summaryMeta = generated.meta;
			}
			return buildSearchReturn({
				queryList,
				results: searchResults,
				urls: allUrls,
				includeContent: params.includeContent ?? false,
				inlineContent: allInlineContent.length > 0 ? allInlineContent : void 0,
				workflow: workflow === "auto-summary" ? "auto-summary" : void 0,
				approvedSummary,
				summaryMeta
			});
		},
		renderCall(args, theme) {
			const input = args;
			const queryList = normalizeQueryList(Array.isArray(input.queries) ? input.queries : input.query !== void 0 ? [input.query] : []);
			if (queryList.length === 0) return new Text(theme.fg("toolTitle", theme.bold("search ")) + theme.fg("error", "(no query)"), 0, 0);
			if (queryList.length === 1) {
				const q = queryList[0];
				const display = q.length > 60 ? q.slice(0, 57) + "..." : q;
				return new Text(theme.fg("toolTitle", theme.bold("search ")) + theme.fg("accent", `"${display}"`), 0, 0);
			}
			const lines = [theme.fg("toolTitle", theme.bold("search ")) + theme.fg("accent", `${queryList.length} queries`)];
			for (const q of queryList.slice(0, 5)) {
				const display = q.length > 50 ? q.slice(0, 47) + "..." : q;
				lines.push(theme.fg("muted", `  "${display}"`));
			}
			if (queryList.length > 5) lines.push(theme.fg("muted", `  ... and ${queryList.length - 5} more`));
			return new Text(lines.join("\n"), 0, 0);
		},
		renderResult(result, { expanded, isPartial }, theme) {
			const details = result.details;
			if (isPartial) {
				if (details?.phase === "curator-fallback") {
					const lines = [theme.fg("warning", "Open the search curator manually:")];
					if (details?.curatorUrl) lines.push(theme.fg("muted", `  ${details.curatorUrl}`));
					if (details?.browserOpenError) lines.push(theme.fg("dim", `  auto-open failed: ${details.browserOpenError}`));
					const timeout = typeof details?.timeoutSeconds === "number" ? details.timeoutSeconds : void 0;
					const shortcut = typeof details?.shortcut === "string" ? details.shortcut : curateKey;
					lines.push(theme.fg("dim", timeout ? `  auto-submits after ${timeout}s idle; ${shortcut} reopens` : `  ${shortcut} reopens`));
					return new Text(lines.join("\n"), 0, 0);
				}
				if (details?.phase === "curating" || details?.phase === "waiting-for-approval" || details?.phase === "generating-summary") {
					const phaseText = details?.phase === "generating-summary" ? "generating summary draft..." : details?.phase === "waiting-for-approval" ? "summary draft ready; approve in browser..." : "waiting for summary approval in browser...";
					const lines = [theme.fg("accent", phaseText)];
					if (details?.curatorUrl) lines.push(theme.fg("muted", `  ${details.curatorUrl}`));
					const timeout = typeof details?.timeoutSeconds === "number" ? details.timeoutSeconds : void 0;
					const shortcut = typeof details?.shortcut === "string" ? details.shortcut : curateKey;
					if (timeout) lines.push(theme.fg("dim", `  auto-submits after ${timeout}s idle; ${shortcut} reopens`));
					else lines.push(theme.fg("dim", `  ${shortcut} reopens`));
					return new Text(lines.join("\n"), 0, 0);
				}
				if (details?.phase === "searching") {
					const progress = details?.progress ?? 0;
					const bar = "█".repeat(Math.floor(progress * 10)) + "░".repeat(10 - Math.floor(progress * 10));
					const query = details?.currentQuery || "";
					const display = query.length > 40 ? query.slice(0, 37) + "..." : query;
					return new Text(theme.fg("accent", `[${bar}] ${display}`), 0, 0);
				}
				const progress = details?.progress ?? 0;
				const bar = "█".repeat(Math.floor(progress * 10)) + "░".repeat(10 - Math.floor(progress * 10));
				return new Text(theme.fg("accent", `[${bar}] ${details?.phase || "searching"}`), 0, 0);
			}
			if (details?.error) {
				const plan = buildSearchErrorPlan(details);
				if (plan) return renderSearchErrorPlan(plan, expanded, theme);
				return new Text(theme.fg("error", `Error: ${details.error}`), 0, 0);
			}
			let statusLine;
			const queryInfo = details?.queryCount === 1 ? "" : `${details?.successfulQueries}/${details?.queryCount} queries, `;
			statusLine = theme.fg("success", `${queryInfo}${details?.totalResults ?? 0} sources`);
			if (details?.curated && details?.curatedFrom) statusLine += theme.fg("muted", ` (${details.queryCount}/${details.curatedFrom} queries curated)`);
			if (details?.fetchId && details?.fetchUrls) statusLine += theme.fg("muted", ` (fetching ${details.fetchUrls.length} URLs)`);
			else if (details?.fetchId) statusLine += theme.fg("muted", " (content ready)");
			const lines = [statusLine];
			if (details?.summary?.text) {
				lines.push("");
				lines.push(theme.fg("accent", `── Summary (${details.summary.workflow}) ` + "─".repeat(32)));
				lines.push("");
				for (const line of details.summary.text.split("\n")) lines.push(`  ${line}`);
				lines.push("");
				const metaParts = [
					details.summary.model ? `model=${details.summary.model}` : "model=deterministic",
					`duration=${details.summary.durationMs}ms`,
					`tokens~${details.summary.tokenEstimate}`,
					details.summary.fallbackUsed ? "fallback=true" : "fallback=false",
					details.summary.edited ? "edited=true" : "edited=false"
				];
				if (details.summary.fallbackReason) metaParts.push(`reason=${details.summary.fallbackReason}`);
				lines.push(theme.fg("dim", "  " + metaParts.join(" · ")));
			}
			const queryDetails = details?.curatedQueries;
			if (queryDetails?.length) {
				const kept = queryDetails.length;
				const from = details?.curatedFrom ?? kept;
				lines.push("");
				lines.push(theme.fg("accent", `\u2500\u2500 Curated Results (${kept} of ${from} queries kept) ` + "─".repeat(24)));
				for (const cq of queryDetails) {
					lines.push("");
					const dq = cq.query.length > 65 ? cq.query.slice(0, 62) + "..." : cq.query;
					const providerLabel = cq.provider ? ` (${cq.provider})` : "";
					lines.push(theme.fg("accent", `  "${dq}"${providerLabel}`));
					if (cq.error) lines.push(theme.fg("error", `  ${cq.error}`));
					else if (cq.answer) {
						lines.push("");
						for (const line of cq.answer.split("\n")) lines.push(`  ${line}`);
					}
					if (cq.sources.length > 0) {
						lines.push("");
						for (const s of cq.sources) {
							const domain = s.url.replace(/^https?:\/\//, "").replace(/\/.*$/, "");
							const title = s.title.length > 50 ? s.title.slice(0, 47) + "..." : s.title;
							lines.push(theme.fg("muted", `  \u25b8 ${title}`) + theme.fg("dim", ` \u00b7 ${domain}`));
						}
					}
				}
				lines.push("");
			} else {
				const textContent = result.content.find((c) => c.type === "text")?.text || "";
				const preview = textContent.length > 500 ? textContent.slice(0, 500) + "..." : textContent;
				for (const line of preview.split("\n")) lines.push(theme.fg("dim", line));
			}
			if (details?.fetchUrls && details.fetchUrls.length > 0) if (details.curated) lines.push(theme.fg("muted", `Fetching ${details.fetchUrls.length} URLs in background`));
			else {
				lines.push(theme.fg("muted", "Fetching:"));
				for (const u of details.fetchUrls.slice(0, 5)) {
					const display = u.length > 60 ? u.slice(0, 57) + "..." : u;
					lines.push(theme.fg("dim", "  " + display));
				}
				if (details.fetchUrls.length > 5) lines.push(theme.fg("dim", `  ... and ${details.fetchUrls.length - 5} more`));
			}
			const totalLines = lines.length;
			if (!expanded) {
				const box = new Box(1, 0, (t) => theme.bg("toolSuccessBg", t));
				box.addChild(new Text(statusLine, 0, 0));
				let collapsedLines = 1;
				const summaryPreview = details?.summary?.text?.trim() || "";
				if (summaryPreview) {
					const preview = summaryPreview.length > 120 ? summaryPreview.slice(0, 117) + "..." : summaryPreview;
					box.addChild(new Text(theme.fg("dim", preview), 0, 0));
					collapsedLines++;
				} else if (details?.curatedQueries?.length) {
					for (const cq of details.curatedQueries.slice(0, 3)) {
						const dq = cq.query.length > 55 ? cq.query.slice(0, 52) + "..." : cq.query;
						const srcCount = cq.sources?.length ?? 0;
						const suffix = cq.error ? theme.fg("error", " (error)") : theme.fg("dim", ` · ${srcCount} sources`);
						box.addChild(new Text(theme.fg("accent", `  "${dq}"`) + suffix, 0, 0));
						collapsedLines++;
					}
					if (details.curatedQueries.length > 3) {
						box.addChild(new Text(theme.fg("dim", `  ... and ${details.curatedQueries.length - 3} more`), 0, 0));
						collapsedLines++;
					}
				} else {
					const fallbackLine = ((result.content.find((c) => c.type === "text")?.text || "").split("\n").find((l) => {
						const t = l.trim();
						return t && !t.startsWith("[") && !t.startsWith("#") && !t.startsWith("---");
					})?.trim() || "").replace(/\*\*/g, "");
					if (fallbackLine) {
						const preview = fallbackLine.length > 120 ? fallbackLine.slice(0, 117) + "..." : fallbackLine;
						box.addChild(new Text(theme.fg("dim", preview), 0, 0));
						collapsedLines++;
					}
				}
				const moreLines = Math.max(0, totalLines - collapsedLines);
				if (moreLines > 0) box.addChild(new Text(theme.fg("muted", `\n... (${moreLines} more lines, ${totalLines} total, ctrl+o to expand)`), 0, 0));
				return box;
			}
			return new Text(lines.join("\n"), 0, 0);
		}
	});
	pi.registerTool({
		name: "fetch_content",
		label: "Fetch Content",
		description: "Fetch URL(s) and extract readable content as markdown. Supports YouTube video transcripts (with thumbnail), GitHub repository contents, and local video files (with frame thumbnail). Video frames can be extracted via timestamp/range or sampled across the entire video with frames alone. Falls back to Gemini for pages that block bots or fail Readability extraction. For YouTube and video files: ALWAYS pass the user's specific question via the prompt parameter — this directs the AI to focus on that aspect of the video, producing much better results than a generic extraction. Content is always stored and can be retrieved with get_search_content.",
		promptSnippet: "Use to extract readable content from URL(s), YouTube, GitHub repos, or local videos. For video questions, pass the user's exact question in prompt.",
		parameters: Type.Object({
			url: Type.Optional(Type.String({ description: "Single URL to fetch" })),
			urls: Type.Optional(Type.Array(Type.String(), { description: "Multiple URLs (parallel)" })),
			forceClone: Type.Optional(Type.Boolean({ description: "Force cloning large GitHub repositories that exceed the size threshold" })),
			prompt: Type.Optional(Type.String({ description: "Question or instruction for video analysis (YouTube and video files). Pass the user's specific question here — e.g. 'describe the book shown at the advice for beginners section'. Without this, a generic transcript extraction is used which may miss what the user is asking about." })),
			timestamp: Type.Optional(Type.String({ description: "Extract video frame(s) at a timestamp or time range. Single: '1:23:45', '23:45', or '85' (seconds). Range: '23:41-25:00' extracts evenly-spaced frames across that span (default 6). Use frames with ranges to control density; single+frames uses a fixed 5s interval. YouTube requires yt-dlp + ffmpeg; local videos require ffmpeg. Use a range when you know the approximate area but not the exact moment — you'll get a contact sheet to visually identify the right frame." })),
			frames: Type.Optional(Type.Integer({
				minimum: 1,
				maximum: 12,
				description: "Number of frames to extract. Use with timestamp range for custom density, with single timestamp to get N frames at 5s intervals, or alone to sample across the entire video. Requires yt-dlp + ffmpeg for YouTube, ffmpeg for local video."
			})),
			model: Type.Optional(Type.String({ description: "Override the Gemini model for video/YouTube analysis (e.g. 'gemini-2.5-flash', 'gemini-3-flash-preview'). Defaults to config or gemini-3-flash-preview." }))
		}),
		async execute(_toolCallId, params, signal, onUpdate) {
			const { urlList, options } = normalizeFetchContentParams(params);
			if (urlList.length === 0) return {
				content: [{
					type: "text",
					text: "Error: No URL provided."
				}],
				details: { error: "No URL provided" }
			};
			onUpdate?.({
				content: [{
					type: "text",
					text: `Fetching ${urlList.length} URL(s)...`
				}],
				details: {
					phase: "fetch",
					progress: 0
				}
			});
			const { fetchAllContent } = await loadExtract();
			const fetchResults = await fetchAllContent(urlList, signal, options);
			const successful = fetchResults.filter((r) => !r.error).length;
			const totalChars = fetchResults.reduce((sum, r) => sum + r.content.length, 0);
			const responseId = generateId();
			const data = {
				id: responseId,
				type: "fetch",
				timestamp: Date.now(),
				urls: stripThumbnails(fetchResults)
			};
			storeResult(responseId, data);
			pi.appendEntry("web-search-results", data);
			if (urlList.length === 1) {
				const result = fetchResults[0];
				if (result.error) return {
					content: [{
						type: "text",
						text: `Error: ${result.error}`
					}],
					details: {
						urls: urlList,
						urlCount: 1,
						successful: 0,
						error: result.error,
						responseId,
						prompt: params.prompt,
						timestamp: params.timestamp,
						frames: params.frames
					}
				};
				const fullLength = result.content.length;
				const truncated = fullLength > MAX_INLINE_CONTENT;
				let output = truncated ? result.content.slice(0, MAX_INLINE_CONTENT) + "\n\n[Content truncated...]" : result.content;
				if (truncated) output += `\n\n---\nShowing ${MAX_INLINE_CONTENT} of ${fullLength} chars. Use get_search_content({ responseId: "${responseId}", urlIndex: 0 }) for full content.`;
				const content = [];
				if (result.frames?.length) for (const frame of result.frames) {
					content.push({
						type: "image",
						data: frame.data,
						mimeType: frame.mimeType
					});
					content.push({
						type: "text",
						text: `Frame at ${frame.timestamp}`
					});
				}
				else if (result.thumbnail) content.push({
					type: "image",
					data: result.thumbnail.data,
					mimeType: result.thumbnail.mimeType
				});
				content.push({
					type: "text",
					text: output
				});
				const imageCount = (result.frames?.length ?? 0) + (result.thumbnail ? 1 : 0);
				return {
					content,
					details: {
						urls: urlList,
						urlCount: 1,
						successful: 1,
						totalChars: fullLength,
						title: result.title,
						responseId,
						truncated,
						hasImage: imageCount > 0,
						imageCount,
						prompt: params.prompt,
						timestamp: params.timestamp,
						frames: params.frames,
						duration: result.duration
					}
				};
			}
			let output = "## Fetched URLs\n\n";
			for (const { url, title, content, error } of fetchResults) if (error) output += `- ${url}: Error - ${error}\n`;
			else output += `- ${title || url} (${content.length} chars)\n`;
			output += `\n---\nUse get_search_content({ responseId: "${responseId}", urlIndex: 0 }) to retrieve full content.`;
			return {
				content: [{
					type: "text",
					text: output
				}],
				details: {
					urls: urlList,
					urlCount: urlList.length,
					successful,
					totalChars,
					responseId
				}
			};
		},
		renderCall(args, theme) {
			const { url, urls, prompt, timestamp, frames, model } = args;
			const urlList = urls ?? (url ? [url] : []);
			if (urlList.length === 0) return new Text(theme.fg("toolTitle", theme.bold("fetch ")) + theme.fg("error", "(no URL)"), 0, 0);
			const lines = [];
			if (urlList.length === 1) {
				const display = urlList[0].length > 60 ? urlList[0].slice(0, 57) + "..." : urlList[0];
				lines.push(theme.fg("toolTitle", theme.bold("fetch ")) + theme.fg("accent", display));
			} else {
				lines.push(theme.fg("toolTitle", theme.bold("fetch ")) + theme.fg("accent", `${urlList.length} URLs`));
				for (const u of urlList.slice(0, 5)) {
					const display = u.length > 60 ? u.slice(0, 57) + "..." : u;
					lines.push(theme.fg("muted", "  " + display));
				}
				if (urlList.length > 5) lines.push(theme.fg("muted", `  ... and ${urlList.length - 5} more`));
			}
			if (timestamp) lines.push(theme.fg("dim", "  timestamp: ") + theme.fg("warning", timestamp));
			if (typeof frames === "number") lines.push(theme.fg("dim", "  frames: ") + theme.fg("warning", String(frames)));
			if (prompt) {
				const display = prompt.length > 250 ? prompt.slice(0, 247) + "..." : prompt;
				lines.push(theme.fg("dim", "  prompt: ") + theme.fg("muted", `"${display}"`));
			}
			if (model) lines.push(theme.fg("dim", "  model: ") + theme.fg("warning", model));
			return new Text(lines.join("\n"), 0, 0);
		},
		renderResult(result, { expanded, isPartial }, theme) {
			const details = result.details;
			if (isPartial) {
				const progress = details?.progress ?? 0;
				const bar = "█".repeat(Math.floor(progress * 10)) + "░".repeat(10 - Math.floor(progress * 10));
				return new Text(theme.fg("accent", `[${bar}] ${details?.phase || "fetching"}`), 0, 0);
			}
			if (details?.error) {
				const fd = details;
				const extras = [];
				if (typeof fd.urlCount === "number" || typeof fd.successful === "number") extras.push(`urls: ${fd.successful ?? 0}/${fd.urlCount ?? 0} succeeded`);
				if (fd.responseId) extras.push(`response id: ${fd.responseId}`);
				if (fd.urls && fd.urls.length > 0) {
					for (const u of fd.urls.slice(0, 8)) extras.push(`  \u25b8 ${u}`);
					if (fd.urls.length > 8) extras.push(`  ... and ${fd.urls.length - 8} more`);
				}
				const plan = buildSearchErrorPlan({
					error: details.error,
					extraLines: extras
				});
				if (plan) return renderSearchErrorPlan(plan, expanded, theme);
				return new Text(theme.fg("error", `Error: ${details.error}`), 0, 0);
			}
			if (details?.urlCount === 1) {
				const title = details?.title || "Untitled";
				const imgCount = details?.imageCount ?? (details?.hasImage ? 1 : 0);
				const imageBadge = imgCount > 1 ? theme.fg("accent", ` [${imgCount} images]`) : imgCount === 1 ? theme.fg("accent", " [image]") : "";
				let statusLine = theme.fg("success", title) + theme.fg("muted", ` (${details?.totalChars ?? 0} chars)`) + imageBadge;
				if (details?.truncated) statusLine += theme.fg("warning", " [truncated]");
				if (typeof details?.duration === "number") statusLine += theme.fg("muted", ` | ${formatSeconds(Math.floor(details.duration))} total`);
				const textContent = result.content.find((c) => c.type === "text")?.text || "";
				if (!expanded) {
					const brief = textContent.length > 200 ? textContent.slice(0, 200) + "..." : textContent;
					return new Text(statusLine + "\n" + theme.fg("dim", brief), 0, 0);
				}
				const lines = [statusLine];
				if (details?.prompt) {
					const display = details.prompt.length > 250 ? details.prompt.slice(0, 247) + "..." : details.prompt;
					lines.push(theme.fg("dim", `  prompt: "${display}"`));
				}
				if (details?.timestamp) lines.push(theme.fg("dim", `  timestamp: ${details.timestamp}`));
				if (typeof details?.frames === "number") lines.push(theme.fg("dim", `  frames: ${details.frames}`));
				const preview = textContent.length > 500 ? textContent.slice(0, 500) + "..." : textContent;
				lines.push(theme.fg("dim", preview));
				return new Text(lines.join("\n"), 0, 0);
			}
			const countColor = (details?.successful ?? 0) > 0 ? "success" : "error";
			const statusLine = theme.fg(countColor, `${details?.successful}/${details?.urlCount} URLs`) + theme.fg("muted", " (content stored)");
			if (!expanded) return new Text(statusLine, 0, 0);
			const textContent = result.content.find((c) => c.type === "text")?.text || "";
			const preview = textContent.length > 500 ? textContent.slice(0, 500) + "..." : textContent;
			return new Text(statusLine + "\n" + theme.fg("dim", preview), 0, 0);
		}
	});
	pi.registerTool({
		name: "get_search_content",
		label: "Get Search Content",
		description: "Retrieve full content from a previous web_search or fetch_content call.",
		promptSnippet: "Use after web_search/fetch_content when full stored content is needed via responseId plus query/url selectors.",
		parameters: Type.Object({
			responseId: Type.String({ description: "The responseId from web_search or fetch_content" }),
			query: Type.Optional(Type.String({ description: "Get content for this query (web_search)" })),
			queryIndex: Type.Optional(Type.Number({ description: "Get content for query at index" })),
			url: Type.Optional(Type.String({ description: "Get content for this URL" })),
			urlIndex: Type.Optional(Type.Number({ description: "Get content for URL at index" }))
		}),
		async execute(_toolCallId, params) {
			const data = getResult(params.responseId);
			if (!data) return {
				content: [{
					type: "text",
					text: `Error: No stored results for "${params.responseId}"`
				}],
				details: {
					error: "Not found",
					responseId: params.responseId
				}
			};
			if (data.type === "search" && data.queries) {
				let queryData;
				if (params.query !== void 0) {
					queryData = data.queries.find((q) => q.query === params.query);
					if (!queryData) {
						const available = data.queries.map((q) => `"${q.query}"`).join(", ");
						return {
							content: [{
								type: "text",
								text: `Query "${params.query}" not found. Available: ${available}`
							}],
							details: { error: "Query not found" }
						};
					}
				} else if (params.queryIndex !== void 0) {
					queryData = data.queries[params.queryIndex];
					if (!queryData) return {
						content: [{
							type: "text",
							text: `Index ${params.queryIndex} out of range (0-${data.queries.length - 1})`
						}],
						details: { error: "Index out of range" }
					};
				} else return {
					content: [{
						type: "text",
						text: `Specify query or queryIndex. Available: ${data.queries.map((q, i) => `${i}: "${q.query}"`).join(", ")}`
					}],
					details: { error: "No query specified" }
				};
				if (queryData.error) return {
					content: [{
						type: "text",
						text: `Error for "${queryData.query}": ${queryData.error}`
					}],
					details: {
						error: queryData.error,
						query: queryData.query
					}
				};
				return {
					content: [{
						type: "text",
						text: formatFullResults(queryData)
					}],
					details: {
						query: queryData.query,
						resultCount: queryData.results.length
					}
				};
			}
			if (data.type === "fetch" && data.urls) {
				let urlData;
				if (params.url !== void 0) {
					urlData = data.urls.find((u) => u.url === params.url);
					if (!urlData) return {
						content: [{
							type: "text",
							text: `URL not found. Available:\n  ${data.urls.map((u) => u.url).join("\n  ")}`
						}],
						details: { error: "URL not found" }
					};
				} else if (params.urlIndex !== void 0) {
					urlData = data.urls[params.urlIndex];
					if (!urlData) return {
						content: [{
							type: "text",
							text: `Index ${params.urlIndex} out of range (0-${data.urls.length - 1})`
						}],
						details: { error: "Index out of range" }
					};
				} else return {
					content: [{
						type: "text",
						text: `Specify url or urlIndex. Available:\n  ${data.urls.map((u, i) => `${i}: ${u.url}`).join("\n  ")}`
					}],
					details: { error: "No URL specified" }
				};
				if (urlData.error) return {
					content: [{
						type: "text",
						text: `Error for ${urlData.url}: ${urlData.error}`
					}],
					details: {
						error: urlData.error,
						url: urlData.url
					}
				};
				return {
					content: [{
						type: "text",
						text: `# ${urlData.title}\n\n${urlData.content}`
					}],
					details: {
						url: urlData.url,
						title: urlData.title,
						contentLength: urlData.content.length
					}
				};
			}
			return {
				content: [{
					type: "text",
					text: "Invalid stored data format"
				}],
				details: { error: "Invalid data" }
			};
		},
		renderCall(args, theme) {
			const { responseId, query, queryIndex, url, urlIndex } = args;
			let target = "";
			if (query) target = `query="${query}"`;
			else if (queryIndex !== void 0) target = `queryIndex=${queryIndex}`;
			else if (url) target = url.length > 30 ? url.slice(0, 27) + "..." : url;
			else if (urlIndex !== void 0) target = `urlIndex=${urlIndex}`;
			return new Text(theme.fg("toolTitle", theme.bold("get_content ")) + theme.fg("accent", target || responseId.slice(0, 8)), 0, 0);
		},
		renderResult(result, { expanded }, theme) {
			const details = result.details;
			if (details?.error) {
				const extras = [];
				if (details.query) extras.push(`query: ${details.query}`);
				if (details.url) extras.push(`url: ${details.url}`);
				else if (details.title) extras.push(`resource: ${details.title}`);
				const plan = buildSearchErrorPlan({
					error: details.error,
					extraLines: extras
				});
				if (plan) return renderSearchErrorPlan(plan, expanded, theme);
				return new Text(theme.fg("error", `Error: ${details.error}`), 0, 0);
			}
			let statusLine;
			if (details?.query) statusLine = theme.fg("success", `"${details.query}"`) + theme.fg("muted", ` (${details.resultCount} results)`);
			else statusLine = theme.fg("success", details?.title || "Content") + theme.fg("muted", ` (${details?.contentLength ?? 0} chars)`);
			if (!expanded) return new Text(statusLine, 0, 0);
			const textContent = result.content.find((c) => c.type === "text")?.text || "";
			const preview = textContent.length > 500 ? textContent.slice(0, 500) + "..." : textContent;
			return new Text(statusLine + "\n" + theme.fg("dim", preview), 0, 0);
		}
	});
	pi.registerCommand("websearch", {
		description: "Open web search curator",
		handler: async (args, ctx) => {
			const sessionToken = randomUUID();
			const commandCallId = `cmd:${sessionToken}`;
			closeCurator(commandCallId);
			const raw = args.trim();
			const queries = raw.length > 0 ? normalizeQueryList(raw.split(",")) : [];
			let bootstrap;
			try {
				bootstrap = await loadCuratorBootstrap(void 0, ctx);
			} catch (err) {
				const message = err instanceof Error ? err.message : String(err);
				ctx.ui.notify(`Failed to load web search config: ${message}`, "error");
				return;
			}
			const availableProviders = bootstrap.availableProviders;
			const initialProvider = bootstrap.defaultProvider;
			const curatorTimeoutSeconds = bootstrap.timeoutSeconds;
			let currentSearchProvider = (normalizeProviderInput(loadConfig().provider ?? "auto") ?? "auto") === "auto" ? "auto" : initialProvider;
			const summaryContext = {
				model: ctx.model,
				modelRegistry: ctx.modelRegistry,
				cwd: ctx.cwd,
				isProjectTrusted: () => ctx.isProjectTrusted()
			};
			const summaryModelChoices = await loadSummaryModelChoices(summaryContext);
			ctx.ui.notify("Opening web search curator...", "info");
			const collected = /* @__PURE__ */ new Map();
			const searchAbort = new AbortController();
			let aborted = false;
			let commandHandle = null;
			const isCommandActive = () => commandHandle !== null && activeCurators.get(commandCallId) === commandHandle;
			function sendFollowUpFromReturn(payload) {
				pi.sendMessage({
					customType: "web-search-results",
					content: payload.content,
					display: true,
					details: payload.details
				}, {
					triggerTurn: true,
					deliverAs: "followUp"
				});
			}
			try {
				const handle = await (await loadCuratorServer()).startCuratorServer({
					queries,
					sessionToken,
					timeout: curatorTimeoutSeconds,
					availableProviders,
					defaultProvider: initialProvider,
					searchProvider: currentSearchProvider,
					summaryModels: summaryModelChoices.summaryModels,
					defaultSummaryModel: summaryModelChoices.defaultSummaryModel
				}, {
					async onSummarize(selectedQueryIndices, summarizeSignal, model, feedback) {
						if (commandHandle && !isCommandActive()) throw new Error("Curator session is no longer active.");
						return generateSummaryForSelectedIndices(selectedQueryIndices, collected, summaryContext, summarizeSignal, model, feedback);
					},
					async onSubmit(payload) {
						if (commandHandle && !isCommandActive()) return;
						aborted = true;
						searchAbort.abort();
						const filtered = payload.selectedQueryIndices.length > 0 ? filterByQueryIndices(payload.selectedQueryIndices, collected) : collectAllResultsAndUrls(collected);
						const base = {
							queryList: filtered.results.map((r) => r.query),
							results: filtered.results,
							urls: filtered.urls,
							includeContent: false,
							curated: true,
							curatedFrom: collected.size
						};
						if (!payload.rawResults) {
							const resolvedSummary = await resolveSummaryForSubmit(payload, collected);
							base.workflow = "summary-review";
							base.approvedSummary = resolvedSummary.approvedSummary;
							base.summaryMeta = resolvedSummary.summaryMeta;
						}
						sendFollowUpFromReturn(buildSearchReturn(base));
						closeCurator(commandCallId);
					},
					async onCancel(reason) {
						if (commandHandle && !isCommandActive()) return;
						aborted = true;
						searchAbort.abort();
						if (reason === "timeout") {
							const all = collectAllResultsAndUrls(collected);
							const resolvedSummary = await resolveSummaryForSubmit({
								selectedQueryIndices: [],
								summary: void 0,
								summaryMeta: void 0
							}, collected);
							sendFollowUpFromReturn(buildSearchReturn({
								queryList: all.results.map((r) => r.query),
								results: all.results,
								urls: all.urls,
								includeContent: false,
								curated: true,
								curatedFrom: collected.size,
								workflow: "summary-review",
								approvedSummary: resolvedSummary.approvedSummary,
								summaryMeta: resolvedSummary.summaryMeta
							}));
						}
						closeCurator(commandCallId);
					},
					onProviderChange(provider) {
						if (commandHandle && !isCommandActive()) return;
						const normalized = normalizeProviderInput(provider);
						if (!normalized || normalized === "auto") return;
						currentSearchProvider = normalized;
						try {
							saveConfig({ provider: normalized });
						} catch (err) {
							const message = err instanceof Error ? err.message : String(err);
							console.error(`Failed to persist default provider: ${message}`);
						}
					},
					async onAddSearch(query, queryIndex, provider) {
						if (commandHandle && !isCommandActive()) throw new Error("Curator session is no longer active.");
						const normalizedProvider = normalizeProviderInput(provider);
						const requestedProvider = !normalizedProvider || normalizedProvider === "auto" ? currentSearchProvider : normalizedProvider;
						try {
							const { answer, results, provider: actualProvider } = await (await loadGeminiSearch()).search(query, {
								provider: requestedProvider,
								signal: searchAbort.signal,
								extensionContext: ctx
							});
							if (commandHandle && !isCommandActive()) throw new Error("Curator session is no longer active.");
							collected.set(queryIndex, {
								query,
								answer,
								results,
								error: null,
								provider: actualProvider
							});
							return {
								answer,
								results: results.map((r) => ({
									title: r.title,
									url: r.url,
									domain: extractDomain(r.url)
								})),
								provider: actualProvider
							};
						} catch (err) {
							const message = err instanceof Error ? err.message : String(err);
							if (!commandHandle || isCommandActive()) collected.set(queryIndex, {
								query,
								answer: "",
								results: [],
								error: message,
								provider: requestedProvider
							});
							throw err;
						}
					},
					async onRewriteQuery(query, rewriteSignal) {
						if (commandHandle && !isCommandActive()) throw new Error("Curator session is no longer active.");
						return rewriteSearchQuery(query, summaryContext, rewriteSignal);
					}
				});
				commandHandle = handle;
				activeCurators.set(commandCallId, handle);
				const open = platform() === "darwin" ? await getGlimpseOpen() : null;
				let browserOpenError = null;
				if (open) try {
					const win = openInGlimpse(open, handle.url, "Search Curator");
					glimpseWins.set(commandCallId, win);
					win.on("closed", () => {
						if (glimpseWins.get(commandCallId) === win) {
							glimpseWins.delete(commandCallId);
							closeCurator(commandCallId);
						}
					});
				} catch (err) {
					const message = err instanceof Error ? err.message : String(err);
					console.error(`Failed to open Glimpse curator window: ${message}`);
					glimpseWins.delete(commandCallId);
					try {
						await openInBrowser(pi, handle.url);
					} catch (browserErr) {
						browserOpenError = browserErr instanceof Error ? browserErr.message : String(browserErr);
					}
				}
				else try {
					await openInBrowser(pi, handle.url);
				} catch (browserErr) {
					browserOpenError = browserErr instanceof Error ? browserErr.message : String(browserErr);
				}
				if (browserOpenError) {
					console.error(`Failed to open curator UI: ${browserOpenError}`);
					ctx.ui.notify(`Search curator is running, but the browser did not open automatically. Open manually: ${handle.url}`, "info");
				}
				if (queries.length > 0) (async () => {
					for (let qi = 0; qi < queries.length; qi++) {
						if (aborted || !isCommandActive()) break;
						const requestedProvider = currentSearchProvider;
						try {
							const { answer, results, provider } = await (await loadGeminiSearch()).search(queries[qi], {
								provider: requestedProvider,
								signal: searchAbort.signal,
								extensionContext: ctx
							});
							if (aborted || !isCommandActive()) break;
							handle.pushResult(qi, {
								answer,
								results: results.map((r) => ({
									title: r.title,
									url: r.url,
									domain: extractDomain(r.url)
								})),
								provider
							});
							collected.set(qi, {
								query: queries[qi],
								answer,
								results,
								error: null,
								provider
							});
						} catch (err) {
							if (aborted || !isCommandActive()) break;
							const message = err instanceof Error ? err.message : String(err);
							handle.pushError(qi, message, requestedProvider);
							collected.set(qi, {
								query: queries[qi],
								answer: "",
								results: [],
								error: message,
								provider: requestedProvider
							});
						}
					}
					if (!aborted && isCommandActive()) handle.searchesDone();
				})();
				else if (isCommandActive()) handle.searchesDone();
			} catch (err) {
				closeCurator(commandCallId);
				const message = err instanceof Error ? err.message : String(err);
				ctx.ui.notify(`Failed to open curator: ${message}`, "error");
			}
		}
	});
	pi.registerCommand("curator", {
		description: "Toggle or configure the search curator workflow",
		handler: async (args, ctx) => {
			const arg = args.trim().toLowerCase();
			let newWorkflow;
			if (arg.length === 0) newWorkflow = resolveWorkflow(loadConfigForExtensionInit().workflow, true) === "none" ? "summary-review" : "none";
			else if (arg === "on") newWorkflow = "summary-review";
			else if (arg === "off") newWorkflow = "none";
			else if (arg === "none" || arg === "summary-review" || arg === "auto-summary") newWorkflow = arg;
			else {
				ctx.ui.notify(`Unknown option: ${arg}. Use on, off, summary-review, or auto-summary.`, "error");
				return;
			}
			try {
				saveConfig({ workflow: newWorkflow });
			} catch (err) {
				const message = err instanceof Error ? err.message : String(err);
				ctx.ui.notify(`Failed to save config: ${message}`, "error");
				return;
			}
			const label = newWorkflow === "none" ? "Curator disabled — web_search will return raw results" : newWorkflow === "auto-summary" ? "Auto-summary enabled — web_search will generate a summary without opening the curator" : "Curator enabled — web_search will open curator and auto-generate a summary draft";
			pi.sendMessage({
				customType: "curator-config",
				content: [{
					type: "text",
					text: label
				}],
				display: true,
				details: { workflow: newWorkflow }
			}, {
				triggerTurn: false,
				deliverAs: "followUp"
			});
		}
	});
	pi.registerCommand("google-account", {
		description: "Show the active Google account for Gemini Web",
		handler: async () => {
			if (!isBrowserCookieAccessAllowed()) {
				pi.sendMessage({
					customType: "google-account",
					content: [{
						type: "text",
						text: `Gemini Web browser cookie access is disabled. Set allowBrowserCookies: true in ${WEB_SEARCH_CONFIG_PATH} to enable it.`
					}],
					display: true,
					details: {
						available: false,
						cookieAccessAllowed: false
					}
				}, {
					triggerTurn: true,
					deliverAs: "followUp"
				});
				return;
			}
			const { isGeminiWebAvailable, getActiveGoogleEmail } = await loadGeminiWeb();
			const cookies = await isGeminiWebAvailable();
			if (!cookies) {
				pi.sendMessage({
					customType: "google-account",
					content: [{
						type: "text",
						text: "Gemini Web is unavailable. Sign into gemini.google.com in a supported Chromium-based browser."
					}],
					display: true,
					details: {
						available: false,
						cookieAccessAllowed: true
					}
				}, {
					triggerTurn: true,
					deliverAs: "followUp"
				});
				return;
			}
			const email = await getActiveGoogleEmail(cookies);
			const text = email ? `Active Google account: ${email}` : "Gemini Web is available, but the active Google account could not be determined.";
			pi.sendMessage({
				customType: "google-account",
				content: [{
					type: "text",
					text
				}],
				display: true,
				details: {
					available: true,
					email: email ?? null
				}
			}, {
				triggerTurn: true,
				deliverAs: "followUp"
			});
		}
	});
	pi.registerCommand("search", {
		description: "Browse stored web search results",
		handler: async (_args, ctx) => {
			const results = getAllResults();
			if (results.length === 0) {
				ctx.ui.notify("No stored search results", "info");
				return;
			}
			const options = results.map((r) => {
				const age = Math.floor((Date.now() - r.timestamp) / 6e4);
				const ageStr = age < 60 ? `${age}m ago` : `${Math.floor(age / 60)}h ago`;
				if (r.type === "search" && r.queries) {
					const query = r.queries[0]?.query || "unknown";
					return `[${r.id.slice(0, 6)}] "${query}" (${r.queries.length} queries) - ${ageStr}`;
				}
				if (r.type === "fetch" && r.urls) return `[${r.id.slice(0, 6)}] ${r.urls.length} URLs fetched - ${ageStr}`;
				return `[${r.id.slice(0, 6)}] ${r.type} - ${ageStr}`;
			});
			const choice = await ctx.ui.select("Stored Search Results", options);
			if (!choice) return;
			const match = choice.match(/^\[([a-z0-9]+)\]/);
			if (!match) return;
			const selected = results.find((r) => r.id.startsWith(match[1]));
			if (!selected) return;
			const action = await ctx.ui.select(`Result ${selected.id.slice(0, 6)}`, ["View details", "Delete"]);
			if (action === "Delete") {
				deleteResult(selected.id);
				ctx.ui.notify(`Deleted ${selected.id.slice(0, 6)}`, "info");
			} else if (action === "View details") {
				let info = `ID: ${selected.id}\nType: ${selected.type}\nAge: ${Math.floor((Date.now() - selected.timestamp) / 6e4)}m\n\n`;
				if (selected.type === "search" && selected.queries) {
					info += "Queries:\n";
					const queries = selected.queries.slice(0, 10);
					for (const q of queries) info += `- "${q.query}" (${q.results.length} results)\n`;
					if (selected.queries.length > 10) info += `... and ${selected.queries.length - 10} more\n`;
				}
				if (selected.type === "fetch" && selected.urls) {
					info += "URLs:\n";
					const urls = selected.urls.slice(0, 10);
					for (const u of urls) {
						const urlDisplay = u.url.length > 50 ? u.url.slice(0, 47) + "..." : u.url;
						info += `- ${urlDisplay} (${u.error || `${u.content.length} chars`})\n`;
					}
					if (selected.urls.length > 10) info += `... and ${selected.urls.length - 10} more\n`;
				}
				ctx.ui.notify(info, "info");
			}
		}
	});
}
//#endregion
export { cold_start_lazy_import_default as default };

//# sourceMappingURL=index.mjs.map