import { r as getWebSearchConfigPath } from "./utils-_BNFawOs.mjs";
import { t as activityMonitor } from "./activity-Y0iQoAlM.mjs";
import { existsSync, readFileSync } from "node:fs";
//#region brave.ts
const BRAVE_API_URL = "https://api.search.brave.com/res/v1/web/search";
const CONFIG_PATH = getWebSearchConfigPath();
const SEARCH_TIMEOUT_MS = 3e4;
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
	return normalizeApiKey(process.env.BRAVE_API_KEY) ?? normalizeApiKey(loadConfig().braveApiKey);
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
function normalizeDomainFilters(domainFilter) {
	const filters = {
		allowed: [],
		blocked: []
	};
	if (!domainFilter?.length) return filters;
	for (const raw of domainFilter) {
		const domain = normalizeDomain(raw);
		if (!domain) continue;
		const target = raw.trim().startsWith("-") ? filters.blocked : filters.allowed;
		if (!target.includes(domain)) target.push(domain);
	}
	return filters;
}
function buildBraveQuery(query, domainFilter) {
	const filters = normalizeDomainFilters(domainFilter);
	const parts = [query];
	if (filters.allowed.length === 1) parts.push(`site:${filters.allowed[0]}`);
	else if (filters.allowed.length > 1) parts.push(filters.allowed.map((domain) => `site:${domain}`).join(" OR "));
	for (const domain of filters.blocked) parts.push(`NOT site:${domain}`);
	return parts.join(" ");
}
function hostMatchesDomain(hostname, domain) {
	return hostname === domain || hostname.endsWith(`.${domain}`);
}
function matchesDomainFilters(url, filters) {
	if (filters.allowed.length === 0 && filters.blocked.length === 0) return true;
	let hostname = "";
	try {
		hostname = new URL(url).hostname.toLowerCase();
	} catch {
		return false;
	}
	if (filters.allowed.length > 0 && !filters.allowed.some((domain) => hostMatchesDomain(hostname, domain))) return false;
	return !filters.blocked.some((domain) => hostMatchesDomain(hostname, domain));
}
function isBraveAvailable() {
	return !!getApiKey();
}
async function searchWithBrave(query, options = {}) {
	const apiKey = getApiKey();
	if (!apiKey) throw new Error(`Brave Search API key not found. Either:
  1. Create ${CONFIG_PATH} with { "braveApiKey": "your-key" }\n  2. Set BRAVE_API_KEY environment variable
Get a key at https://brave.com/search/api/`);
	const numResults = normalizeCount(options.numResults);
	const domainFilters = normalizeDomainFilters(options.domainFilter);
	const searchQuery = buildBraveQuery(query, options.domainFilter);
	const activityId = activityMonitor.logStart({
		type: "api",
		query: searchQuery
	});
	const params = new URLSearchParams({
		q: searchQuery,
		count: String(options.domainFilter?.length ? 20 : numResults)
	});
	if (options.recencyFilter) {
		const freshness = {
			day: "pd",
			week: "pw",
			month: "pm",
			year: "py"
		}[options.recencyFilter];
		if (freshness) params.set("freshness", freshness);
	}
	try {
		const response = await fetch(`${BRAVE_API_URL}?${params.toString()}`, {
			method: "GET",
			headers: {
				"X-Subscription-Token": apiKey,
				"Accept": "application/json",
				"Accept-Encoding": "gzip"
			},
			signal: options.signal ? AbortSignal.any([AbortSignal.timeout(SEARCH_TIMEOUT_MS), options.signal]) : AbortSignal.timeout(SEARCH_TIMEOUT_MS)
		});
		if (!response.ok) {
			activityMonitor.logError(activityId, `HTTP ${response.status}`);
			const errorText = await response.text();
			throw new Error(`Brave Search API error ${response.status}: ${errorText.slice(0, 300)}`);
		}
		const data = await response.json();
		activityMonitor.logComplete(activityId, response.status);
		const results = [];
		for (const item of data.web?.results ?? []) {
			if (!item.url || !matchesDomainFilters(item.url, domainFilters)) continue;
			results.push({
				title: item.title || item.url,
				url: item.url,
				snippet: item.description || ""
			});
			if (results.length >= numResults) break;
		}
		return {
			answer: results.map((result) => {
				if (result.snippet) return `${result.snippet}\nSource: ${result.title} (${result.url})`;
				return `Source: ${result.title} (${result.url})`;
			}).join("\n\n"),
			results
		};
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		if (message.toLowerCase().includes("abort")) activityMonitor.logComplete(activityId, 0);
		else activityMonitor.logError(activityId, message);
		throw err;
	}
}
//#endregion
export { isBraveAvailable, searchWithBrave };

//# sourceMappingURL=brave-DiQbd-LM.mjs.map