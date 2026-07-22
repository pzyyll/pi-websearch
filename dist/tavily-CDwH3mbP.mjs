import { r as getWebSearchConfigPath } from "./utils-_BNFawOs.mjs";
import { t as activityMonitor } from "./activity-Y0iQoAlM.mjs";
import { existsSync, readFileSync } from "node:fs";
//#region tavily.ts
const TAVILY_API_URL = "https://api.tavily.com/search";
const CONFIG_PATH = getWebSearchConfigPath();
const SEARCH_TIMEOUT_MS = 6e4;
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
function normalizeApiKey(value) {
	if (typeof value !== "string") return null;
	const normalized = value.trim();
	return normalized.length > 0 ? normalized : null;
}
function getApiKey() {
	return normalizeApiKey(process.env.TAVILY_API_KEY) ?? normalizeApiKey(loadConfig().tavilyApiKey);
}
function requireApiKey() {
	const apiKey = getApiKey();
	if (!apiKey) throw new Error(`Tavily API key not found. Either:
  1. Create ${CONFIG_PATH} with { "tavilyApiKey": "your-key" }\n  2. Set TAVILY_API_KEY environment variable
Get a key at https://app.tavily.com/`);
	return apiKey;
}
function normalizeCount(value) {
	if (typeof value !== "number" || !Number.isFinite(value)) return 5;
	return Math.max(1, Math.min(Math.floor(value), 20));
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
		...include_domains.length > 0 ? { include_domains } : {},
		...exclude_domains.length > 0 ? { exclude_domains } : {}
	};
}
function requestSignal(signal) {
	const timeout = AbortSignal.timeout(SEARCH_TIMEOUT_MS);
	return signal ? AbortSignal.any([signal, timeout]) : timeout;
}
function errorMessage(err) {
	return err instanceof Error ? err.message : String(err);
}
function mapResults(results, numResults) {
	if (!Array.isArray(results)) return [];
	const mapped = [];
	for (const item of results) {
		if (!item?.url) continue;
		mapped.push({
			title: item.title || `Source ${mapped.length + 1}`,
			url: item.url,
			snippet: typeof item.content === "string" ? item.content.replace(/\s+/g, " ").trim() : ""
		});
		if (mapped.length >= numResults) break;
	}
	return mapped;
}
function mapInlineContent(results) {
	if (!Array.isArray(results)) return [];
	return results.flatMap((item) => {
		if (!item?.url || typeof item.raw_content !== "string" || item.raw_content.trim().length === 0) return [];
		return [{
			url: item.url,
			title: item.title || "",
			content: item.raw_content,
			error: null
		}];
	});
}
function isTavilyAvailable() {
	return !!getApiKey();
}
async function searchWithTavily(query, options = {}) {
	const numResults = normalizeCount(options.numResults);
	const body = {
		query,
		search_depth: "basic",
		max_results: numResults,
		include_answer: "basic",
		include_raw_content: options.includeContent ? "markdown" : false,
		...options.recencyFilter ? { time_range: options.recencyFilter } : {},
		...mapDomainFilter(options.domainFilter)
	};
	const activityId = activityMonitor.logStart({
		type: "api",
		query
	});
	let response;
	try {
		response = await fetch(TAVILY_API_URL, {
			method: "POST",
			headers: {
				"Authorization": `Bearer ${requireApiKey()}`,
				"Content-Type": "application/json"
			},
			body: JSON.stringify(body),
			signal: requestSignal(options.signal)
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
		throw new Error(`Tavily API error ${response.status}: ${errorText.slice(0, 300)}`);
	}
	let data;
	try {
		data = await response.json();
	} catch (err) {
		activityMonitor.logComplete(activityId, response.status);
		throw new Error(`Tavily API returned invalid JSON: ${errorMessage(err)}`);
	}
	activityMonitor.logComplete(activityId, response.status);
	const result = {
		answer: typeof data.answer === "string" ? data.answer : "",
		results: mapResults(data.results, numResults)
	};
	if (options.includeContent) {
		const inlineContent = mapInlineContent(data.results);
		if (inlineContent.length > 0) result.inlineContent = inlineContent;
	}
	return result;
}
//#endregion
export { isTavilyAvailable, searchWithTavily };

//# sourceMappingURL=tavily-CDwH3mbP.mjs.map