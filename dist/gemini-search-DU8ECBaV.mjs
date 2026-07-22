import { r as getWebSearchConfigPath } from "./utils-_BNFawOs.mjs";
import { t as activityMonitor } from "./activity-Y0iQoAlM.mjs";
import { existsSync, readFileSync } from "node:fs";
//#region gemini-search.ts
const CONFIG_PATH = getWebSearchConfigPath();
let cachedSearchConfig = null;
function getSearchConfig() {
	if (cachedSearchConfig) return cachedSearchConfig;
	if (!existsSync(CONFIG_PATH)) {
		cachedSearchConfig = {
			searchProvider: "auto",
			searchModel: void 0
		};
		return cachedSearchConfig;
	}
	const rawText = readFileSync(CONFIG_PATH, "utf-8");
	let raw;
	try {
		raw = JSON.parse(rawText);
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		throw new Error(`Failed to parse ${CONFIG_PATH}: ${message}`);
	}
	cachedSearchConfig = {
		searchProvider: normalizeSearchProvider(raw.searchProvider ?? raw.provider),
		searchModel: normalizeSearchModel(raw.searchModel)
	};
	return cachedSearchConfig;
}
function normalizeSearchModel(value) {
	if (typeof value !== "string") return void 0;
	const normalized = value.trim();
	return normalized.length > 0 ? normalized : void 0;
}
function normalizeSearchProvider(value) {
	const normalized = typeof value === "string" ? value.trim().toLowerCase() : "";
	return [
		"auto",
		"openai",
		"brave",
		"parallel",
		"tavily",
		"perplexity",
		"gemini",
		"exa"
	].includes(normalized) ? normalized : "auto";
}
function errorMessage(err) {
	return err instanceof Error ? err.message : String(err);
}
function isAbortError(err) {
	return errorMessage(err).toLowerCase().includes("abort");
}
function shouldTryOpenAIInAuto(options) {
	if (options.recencyFilter) return false;
	if (typeof options.numResults === "number" && Number.isFinite(options.numResults) && Math.floor(options.numResults) !== 5) return false;
	return true;
}
async function searchWithGemini(query, options, strictErrors) {
	const errors = [];
	try {
		const apiResult = await searchWithGeminiApi(query, options);
		if (apiResult) return apiResult;
	} catch (err) {
		if (isAbortError(err)) throw err;
		errors.push(`Gemini API: ${errorMessage(err)}`);
	}
	try {
		const webResult = await searchWithGeminiWeb(query, options);
		if (webResult) return webResult;
	} catch (err) {
		if (isAbortError(err)) throw err;
		errors.push(`Gemini Web: ${errorMessage(err)}`);
	}
	if (strictErrors && errors.length > 0) throw new Error(`Gemini search failed:\n  - ${errors.join("\n  - ")}`);
	return null;
}
async function search(query, options = {}) {
	const config = getSearchConfig();
	const provider = options.provider ?? config.searchProvider;
	if (provider === "openai") {
		const { searchWithOpenAI } = await import("./openai-search-BBUbTQfw.mjs");
		return {
			...await searchWithOpenAI(query, options, options.extensionContext),
			provider: "openai"
		};
	}
	if (provider === "brave") {
		const { searchWithBrave } = await import("./brave-DiQbd-LM.mjs");
		return {
			...await searchWithBrave(query, options),
			provider: "brave"
		};
	}
	if (provider === "parallel") {
		const { searchWithParallel } = await import("./parallel-VlcMu7qG.mjs");
		return {
			...await searchWithParallel(query, options),
			provider: "parallel"
		};
	}
	if (provider === "tavily") {
		const { searchWithTavily } = await import("./tavily-CDwH3mbP.mjs");
		return {
			...await searchWithTavily(query, options),
			provider: "tavily"
		};
	}
	if (provider === "perplexity") {
		const { searchWithPerplexity } = await import("./perplexity-BVwSQCyi.mjs");
		return {
			...await searchWithPerplexity(query, options),
			provider: "perplexity"
		};
	}
	if (provider === "gemini") {
		const result = await searchWithGemini(query, options, true);
		if (result) return {
			...result,
			provider: "gemini"
		};
		throw new Error(`Gemini search unavailable. Either:
  1. Set GEMINI_API_KEY in ${CONFIG_PATH}\n  2. Set GOOGLE_GEMINI_BASE_URL + CLOUDFLARE_API_KEY for Cloudflare AI Gateway routing
  3. Sign into gemini.google.com in a supported Chromium-based browser`);
	}
	if (provider === "exa") {
		const { hasExaApiKey, searchWithExa } = await import("./exa-Ca_bEPhU.mjs");
		const exaApiKeyConfigured = hasExaApiKey();
		try {
			const result = await searchWithExa(query, options);
			if (result) return {
				...result,
				provider: "exa"
			};
			if (exaApiKeyConfigured) throw new Error("Exa search returned no results.");
		} catch (err) {
			if ((err instanceof Error ? err.message : String(err)).toLowerCase().includes("abort")) throw err;
			if (exaApiKeyConfigured) throw err;
		}
	}
	const fallbackErrors = [];
	if (shouldTryOpenAIInAuto(options)) try {
		const { isOpenAISearchAvailable, searchWithOpenAI } = await import("./openai-search-BBUbTQfw.mjs");
		if (await isOpenAISearchAvailable(options.extensionContext)) return {
			...await searchWithOpenAI(query, options, options.extensionContext),
			provider: "openai"
		};
	} catch (err) {
		if (isAbortError(err)) throw err;
		fallbackErrors.push(`OpenAI: ${errorMessage(err)}`);
	}
	if (provider !== "exa") try {
		const { isExaAvailable, searchWithExa } = await import("./exa-Ca_bEPhU.mjs");
		if (isExaAvailable()) {
			const result = await searchWithExa(query, options);
			if (result) return {
				...result,
				provider: "exa"
			};
		}
	} catch (err) {
		if (isAbortError(err)) throw err;
		fallbackErrors.push(`Exa: ${errorMessage(err)}`);
	}
	try {
		const { isBraveAvailable, searchWithBrave } = await import("./brave-DiQbd-LM.mjs");
		if (isBraveAvailable()) return {
			...await searchWithBrave(query, options),
			provider: "brave"
		};
	} catch (err) {
		if (isAbortError(err)) throw err;
		fallbackErrors.push(`Brave: ${errorMessage(err)}`);
	}
	try {
		const { isParallelAvailable, searchWithParallel } = await import("./parallel-VlcMu7qG.mjs");
		if (isParallelAvailable()) return {
			...await searchWithParallel(query, options),
			provider: "parallel"
		};
	} catch (err) {
		if (isAbortError(err)) throw err;
		fallbackErrors.push(`Parallel: ${errorMessage(err)}`);
	}
	try {
		const { isTavilyAvailable, searchWithTavily } = await import("./tavily-CDwH3mbP.mjs");
		if (isTavilyAvailable()) return {
			...await searchWithTavily(query, options),
			provider: "tavily"
		};
	} catch (err) {
		if (isAbortError(err)) throw err;
		fallbackErrors.push(`Tavily: ${errorMessage(err)}`);
	}
	try {
		const { isPerplexityAvailable, searchWithPerplexity } = await import("./perplexity-BVwSQCyi.mjs");
		if (isPerplexityAvailable()) return {
			...await searchWithPerplexity(query, options),
			provider: "perplexity"
		};
	} catch (err) {
		if (isAbortError(err)) throw err;
		fallbackErrors.push(`Perplexity: ${errorMessage(err)}`);
	}
	try {
		const geminiResult = await searchWithGemini(query, options, false);
		if (geminiResult) return {
			...geminiResult,
			provider: "gemini"
		};
	} catch (err) {
		if (isAbortError(err)) throw err;
		fallbackErrors.push(`Gemini: ${errorMessage(err)}`);
	}
	if (fallbackErrors.length > 0) throw new Error(`Auto provider search failed:\n  - ${fallbackErrors.join("\n  - ")}`);
	throw new Error(`No search provider available. Either:
  1. Use /login to sign in with a Codex subscription for OpenAI web search
  2. Set openaiApiKey, braveApiKey, parallelApiKey, tavilyApiKey, perplexityApiKey, exaApiKey, geminiApiKey, or cloudflareApiKey in ${CONFIG_PATH}\n  3. Set OPENAI_API_KEY, BRAVE_API_KEY, PARALLEL_API_KEY, TAVILY_API_KEY, EXA_API_KEY, PERPLEXITY_API_KEY, GEMINI_API_KEY, or CLOUDFLARE_API_KEY env vars
  4. Set GOOGLE_GEMINI_BASE_URL with CLOUDFLARE_API_KEY for Cloudflare AI Gateway routing
  5. Sign into gemini.google.com in a supported Chromium-based browser`);
}
async function searchWithGeminiApi(query, options = {}) {
	const { getApiKey, getVersionedApiBase, buildKeyParam, buildAuthHeaders, isGatewayConfigured, DEFAULT_MODEL } = await import("./gemini-api-3ZthksRh.mjs");
	const apiKey = getApiKey();
	if (!apiKey && !isGatewayConfigured()) return null;
	const activityId = activityMonitor.logStart({
		type: "api",
		query
	});
	try {
		const model = getSearchConfig().searchModel ?? DEFAULT_MODEL;
		const body = {
			contents: [{
				role: "user",
				parts: [{ text: query }]
			}],
			tools: [{ google_search: {} }]
		};
		const res = await fetch(`${getVersionedApiBase()}/models/${model}:generateContent${buildKeyParam(apiKey)}`, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				...buildAuthHeaders()
			},
			body: JSON.stringify(body),
			signal: AbortSignal.any([AbortSignal.timeout(6e4), ...options.signal ? [options.signal] : []])
		});
		if (!res.ok) {
			const errorText = await res.text();
			throw new Error(`Gemini API error ${res.status}: ${errorText.slice(0, 300)}`);
		}
		const data = await res.json();
		activityMonitor.logComplete(activityId, res.status);
		const answer = data.candidates?.[0]?.content?.parts?.map((p) => p.text).filter(Boolean).join("\n") ?? "";
		const metadata = data.candidates?.[0]?.groundingMetadata;
		const results = await resolveGroundingChunks(metadata?.groundingChunks, options.signal);
		if (!answer && results.length === 0) return null;
		return {
			answer,
			results
		};
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		if (message.toLowerCase().includes("abort")) activityMonitor.logComplete(activityId, 0);
		else activityMonitor.logError(activityId, message);
		throw err;
	}
}
async function searchWithGeminiWeb(query, options = {}) {
	const { isGeminiWebAvailable, queryWithCookies } = await import("./gemini-web-BcCxdxzO.mjs");
	const cookies = await isGeminiWebAvailable();
	if (!cookies) return null;
	const prompt = buildSearchPrompt(query, options);
	const activityId = activityMonitor.logStart({
		type: "api",
		query
	});
	try {
		const text = await queryWithCookies(prompt, cookies, {
			model: "gemini-3-flash-preview",
			signal: options.signal,
			timeoutMs: 6e4
		});
		activityMonitor.logComplete(activityId, 200);
		return {
			answer: text,
			results: extractSourceUrls(text)
		};
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		if (message.toLowerCase().includes("abort")) activityMonitor.logComplete(activityId, 0);
		else activityMonitor.logError(activityId, message);
		throw err;
	}
}
function buildSearchPrompt(query, options) {
	let prompt = `Search the web and answer the following question. Include source URLs for your claims.\nFormat your response as:\n1. A direct answer to the question\n2. Cited sources as markdown links\n\nQuestion: ${query}`;
	if (options.recencyFilter) prompt += `\n\nOnly include results from the ${{
		day: "past 24 hours",
		week: "past week",
		month: "past month",
		year: "past year"
	}[options.recencyFilter]}.`;
	if (options.domainFilter?.length) {
		const includes = options.domainFilter.filter((d) => !d.startsWith("-"));
		const excludes = options.domainFilter.filter((d) => d.startsWith("-")).map((d) => d.slice(1));
		if (includes.length) prompt += `\n\nOnly cite sources from: ${includes.join(", ")}`;
		if (excludes.length) prompt += `\n\nDo not cite sources from: ${excludes.join(", ")}`;
	}
	return prompt;
}
function extractSourceUrls(markdown) {
	const results = [];
	const seen = /* @__PURE__ */ new Set();
	for (const match of markdown.matchAll(/\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g)) {
		const url = match[2];
		if (seen.has(url)) continue;
		seen.add(url);
		results.push({
			title: match[1],
			url,
			snippet: ""
		});
	}
	return results;
}
async function resolveGroundingChunks(chunks, signal) {
	if (!chunks?.length) return [];
	const results = [];
	for (const chunk of chunks) {
		if (!chunk.web) continue;
		const title = chunk.web.title || "";
		let url = chunk.web.uri || "";
		if (url.includes("vertexaisearch.cloud.google.com/grounding-api-redirect")) {
			const resolved = await resolveRedirect(url, signal);
			if (resolved) url = resolved;
		}
		if (url) results.push({
			title,
			url,
			snippet: ""
		});
	}
	return results;
}
async function resolveRedirect(proxyUrl, signal) {
	try {
		return (await fetch(proxyUrl, {
			method: "HEAD",
			redirect: "manual",
			signal: AbortSignal.any([AbortSignal.timeout(5e3), ...signal ? [signal] : []])
		})).headers.get("location") || null;
	} catch {
		return null;
	}
}
//#endregion
export { search };

//# sourceMappingURL=gemini-search-DU8ECBaV.mjs.map