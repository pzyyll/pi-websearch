import { r as getWebSearchConfigPath } from "./utils-_BNFawOs.mjs";
import { t as activityMonitor } from "./activity-Y0iQoAlM.mjs";
import { existsSync, readFileSync } from "node:fs";
//#region parallel.ts
const PARALLEL_SEARCH_URL = "https://api.parallel.ai/v1/search";
const PARALLEL_EXTRACT_URL = "https://api.parallel.ai/v1/extract";
const CONFIG_PATH = getWebSearchConfigPath();
const MIN_PARALLEL_API_KEY_LENGTH = 8;
const MIN_USEFUL_CONTENT = 500;
const SEARCH_TIMEOUT_MS = 6e4;
const PLACEHOLDER_API_KEY_DENYLIST = /* @__PURE__ */ new Set([
	"replace_with_your_parallel_api_key",
	"parallel_api_key",
	"your-key",
	"your-key-here",
	"your-api-key-here",
	"dummy",
	"placeholder",
	"changeme",
	"insert-your-key",
	"insert-your-key-here",
	"api-key",
	"xxx"
]);
let cachedConfig = null;
function loadConfig() {
	if (cachedConfig) return cachedConfig;
	if (!existsSync(CONFIG_PATH)) {
		cachedConfig = {};
		return cachedConfig;
	}
	const raw = readFileSync(CONFIG_PATH, "utf-8");
	try {
		cachedConfig = JSON.parse(raw);
		return cachedConfig;
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		throw new Error(`Failed to parse ${CONFIG_PATH}: ${message}`);
	}
}
function clearParallelConfigCache() {
	cachedConfig = null;
}
function normalizeApiKey(value) {
	if (typeof value !== "string") return null;
	const normalized = value.trim();
	return normalized.length > 0 ? normalized : null;
}
function isPlaceholderApiKey(key) {
	const normalized = key.trim();
	return normalized.length < MIN_PARALLEL_API_KEY_LENGTH || PLACEHOLDER_API_KEY_DENYLIST.has(normalized.toLowerCase());
}
function resolveApiKey() {
	const envKey = normalizeApiKey(process.env.PARALLEL_API_KEY);
	if (envKey && !isPlaceholderApiKey(envKey)) return envKey;
	const configKey = normalizeApiKey(loadConfig().parallelApiKey);
	if (configKey && !isPlaceholderApiKey(configKey)) return configKey;
	return null;
}
function getApiKey() {
	const key = resolveApiKey();
	if (!key) throw new Error(`Parallel API key not found. Either:
  1. Create ${CONFIG_PATH} with { "parallelApiKey": "your-key" }\n  2. Set PARALLEL_API_KEY environment variable
Get a key at https://platform.parallel.ai`);
	return key;
}
function hasParallelApiKey() {
	return !!resolveApiKey();
}
function isParallelAvailable() {
	return hasParallelApiKey();
}
function requestSignal(signal) {
	const timeout = AbortSignal.timeout(SEARCH_TIMEOUT_MS);
	return signal ? AbortSignal.any([signal, timeout]) : timeout;
}
function errorMessage(err) {
	return err instanceof Error ? err.message : String(err);
}
function activityContext(url, body) {
	if (typeof body.objective === "string" && body.objective.trim().length > 0) return {
		type: "api",
		query: body.objective
	};
	const searchQueries = body.search_queries;
	if (Array.isArray(searchQueries) && typeof searchQueries[0] === "string") return {
		type: "api",
		query: searchQueries[0]
	};
	const urls = body.urls;
	if (Array.isArray(urls) && typeof urls[0] === "string") return {
		type: "fetch",
		url: urls[0]
	};
	return url.includes("/search") ? {
		type: "api",
		query: "Parallel search"
	} : {
		type: "fetch",
		url
	};
}
function recencyToAfterDate(filter) {
	const now = /* @__PURE__ */ new Date();
	const days = {
		day: 1,
		week: 7,
		month: 30,
		year: 365
	}[filter] ?? 0;
	return (/* @__PURE__ */ new Date(now.getTime() - days * 864e5)).toISOString().slice(0, 10);
}
function normalizeDomain(value) {
	let input = value.trim().toLowerCase();
	if (!input) return null;
	if (input.startsWith("-")) input = input.slice(1).trim();
	if (!input) return null;
	try {
		input = (input.includes("://") ? new URL(input) : new URL(`https://${input}`)).hostname;
	} catch {
		input = input.split("/")[0]?.split(":")[0] ?? "";
	}
	input = input.replace(/^\.+|\.+$/g, "");
	return /^[a-z0-9][a-z0-9.-]*\.[a-z]{2,}$/i.test(input) ? input : null;
}
function mapDomainFilter(domainFilter) {
	if (!domainFilter?.length) return {};
	const include_domains = [];
	const exclude_domains = [];
	for (const raw of domainFilter) {
		const domain = normalizeDomain(raw);
		if (!domain) continue;
		const target = raw.trim().startsWith("-") ? exclude_domains : include_domains;
		if (!target.includes(domain)) target.push(domain);
	}
	return {
		...include_domains.length ? { include_domains } : {},
		...exclude_domains.length ? { exclude_domains } : {}
	};
}
function buildSearchRequestBody(query, options = {}) {
	const numResults = Math.max(1, Math.min(Math.floor(options.numResults ?? 5), 20));
	const sourcePolicy = {
		...mapDomainFilter(options.domainFilter),
		...options.recencyFilter ? { after_date: recencyToAfterDate(options.recencyFilter) } : {}
	};
	return {
		objective: query,
		search_queries: [query],
		advanced_settings: {
			max_results: numResults,
			...Object.keys(sourcePolicy).length > 0 ? { source_policy: sourcePolicy } : {}
		}
	};
}
function normalizeExcerpts(value) {
	if (!Array.isArray(value)) return [];
	return value.filter((item) => typeof item === "string" && item.trim().length > 0);
}
function mapSearchResults(results) {
	if (!Array.isArray(results)) return [];
	const mapped = [];
	for (let i = 0; i < results.length; i++) {
		const item = results[i];
		if (!item?.url) continue;
		const excerpts = normalizeExcerpts(item.excerpts);
		mapped.push({
			title: item.title || `Source ${i + 1}`,
			url: item.url,
			snippet: excerpts.length > 0 ? excerpts[0].replace(/\s+/g, " ").trim().slice(0, 200) : ""
		});
	}
	return mapped;
}
function buildAnswerFromExcerpts(results) {
	if (!Array.isArray(results)) return "";
	const parts = [];
	for (let i = 0; i < results.length; i++) {
		const item = results[i];
		if (!item?.url) continue;
		const excerpts = normalizeExcerpts(item.excerpts);
		if (excerpts.length === 0) continue;
		parts.push(`${excerpts.join(" ")}\nSource: ${item.title || `Source ${i + 1}`} (${item.url})`);
	}
	return parts.join("\n\n");
}
function mapInlineContent(results) {
	if (!Array.isArray(results)) return [];
	return results.flatMap((result) => {
		if (!result?.url) return [];
		const excerpts = normalizeExcerpts(result.excerpts);
		if (excerpts.length === 0) return [];
		return [{
			url: result.url,
			title: result.title || "",
			content: excerpts.join("\n\n"),
			error: null
		}];
	});
}
function resolveExtractContent(result) {
	const fullContent = typeof result.full_content === "string" ? result.full_content.trim() : "";
	return fullContent.length > 0 ? fullContent : normalizeExcerpts(result.excerpts).join("\n\n");
}
function mapExtractResult(result) {
	if (!result?.url) return null;
	const content = resolveExtractContent(result);
	if (content.length < MIN_USEFUL_CONTENT) return null;
	return {
		url: result.url,
		title: typeof result.title === "string" ? result.title.trim() : "",
		content,
		error: null
	};
}
function buildExtractRequestBody(url, options = {}, fullContent = false) {
	const body = { urls: [url] };
	const prompt = options.prompt?.trim();
	if (prompt) body.objective = prompt;
	if (fullContent) body.advanced_settings = { full_content: true };
	return body;
}
function findExtractResult(results, url) {
	if (!Array.isArray(results)) return void 0;
	return results.find((item) => item?.url === url) ?? results[0];
}
function hasExtractUrlError(errors, url) {
	if (!Array.isArray(errors)) return false;
	return errors.some((entry) => {
		if (typeof entry === "string") return entry === url;
		return typeof entry === "object" && entry !== null && entry.url === url;
	});
}
async function fetchAndMapExtractResult(url, body, signal) {
	const data = await parallelFetch(PARALLEL_EXTRACT_URL, body, signal);
	if (hasExtractUrlError(data.errors, url)) return {
		mapped: null,
		result: void 0
	};
	const result = findExtractResult(data.results, url);
	return {
		mapped: mapExtractResult(result),
		result
	};
}
async function searchWithParallel(query, options = {}) {
	const results = (await parallelFetch(PARALLEL_SEARCH_URL, buildSearchRequestBody(query, options), options.signal)).results;
	const response = {
		answer: buildAnswerFromExcerpts(results),
		results: mapSearchResults(results)
	};
	if (options.includeContent) {
		const inlineContent = mapInlineContent(results);
		if (inlineContent.length > 0) response.inlineContent = inlineContent;
	}
	return response;
}
async function extractWithParallel(url, signal, options = {}) {
	const initial = await fetchAndMapExtractResult(url, buildExtractRequestBody(url, options), signal);
	if (initial.mapped) return initial.mapped;
	if (!initial.result || resolveExtractContent(initial.result).length >= MIN_USEFUL_CONTENT) return null;
	return (await fetchAndMapExtractResult(url, buildExtractRequestBody(url, options, true), signal)).mapped;
}
async function parallelFetch(url, body, signal) {
	const apiKey = getApiKey();
	const activityId = activityMonitor.logStart(activityContext(url, body));
	let response;
	try {
		response = await fetch(url, {
			method: "POST",
			headers: {
				"x-api-key": apiKey,
				"Content-Type": "application/json"
			},
			body: JSON.stringify(body),
			signal: requestSignal(signal)
		});
	} catch (err) {
		const message = errorMessage(err);
		if (message.toLowerCase().includes("abort")) activityMonitor.logComplete(activityId, 0);
		else activityMonitor.logError(activityId, message);
		throw err;
	}
	if (!response.ok) {
		activityMonitor.logComplete(activityId, response.status);
		const errorText = await response.text();
		throw new Error(`Parallel API error ${response.status}: ${errorText.slice(0, 300)}`);
	}
	try {
		const data = await response.json();
		activityMonitor.logComplete(activityId, response.status);
		return data;
	} catch (err) {
		activityMonitor.logComplete(activityId, response.status);
		throw new Error(`Parallel API returned invalid JSON: ${errorMessage(err)}`);
	}
}
//#endregion
export { clearParallelConfigCache, extractWithParallel, hasParallelApiKey, isParallelAvailable, searchWithParallel };

//# sourceMappingURL=parallel-VlcMu7qG.mjs.map