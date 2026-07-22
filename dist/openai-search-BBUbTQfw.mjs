import { r as getWebSearchConfigPath } from "./utils-_BNFawOs.mjs";
import { t as activityMonitor } from "./activity-Y0iQoAlM.mjs";
import { existsSync, readFileSync } from "node:fs";
//#region openai-search.ts
const OPENAI_RESPONSES_URL = "https://api.openai.com/v1/responses";
const CODEX_RESPONSES_URL = "https://chatgpt.com/backend-api/codex/responses";
const CONFIG_PATH = getWebSearchConfigPath();
const SEARCH_TIMEOUT_MS = 6e4;
const AUTH_MODEL_CANDIDATES = [{
	provider: "openai-codex",
	models: [
		"gpt-5.4",
		"gpt-5.3-codex",
		"gpt-5.3-codex-spark",
		"gpt-5.2",
		"gpt-5.2-codex"
	]
}, {
	provider: "openai",
	models: [
		"gpt-5.4",
		"gpt-5.2",
		"gpt-4.1-mini",
		"gpt-4o"
	]
}];
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
	if (!domainFilter?.length) return null;
	const allowedDomains = [];
	const blockedDomains = [];
	for (const raw of domainFilter) {
		const domain = normalizeDomain(raw);
		if (!domain) continue;
		const target = raw.trim().startsWith("-") ? blockedDomains : allowedDomains;
		if (!target.includes(domain)) target.push(domain);
	}
	return allowedDomains.length > 0 || blockedDomains.length > 0 ? {
		...allowedDomains.length > 0 ? { allowedDomains: allowedDomains.slice(0, 100) } : {},
		...blockedDomains.length > 0 ? { blockedDomains: blockedDomains.slice(0, 100) } : {}
	} : null;
}
function decodeJwtPayload(token) {
	const parts = token.split(".");
	if (parts.length !== 3 || !parts[1]) return null;
	try {
		const padded = parts[1].replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(parts[1].length / 4) * 4, "=");
		const parsed = JSON.parse(Buffer.from(padded, "base64").toString("utf8"));
		return parsed && typeof parsed === "object" ? parsed : null;
	} catch {
		return null;
	}
}
function isCodexJwt(token) {
	return !!decodeJwtPayload(token)?.["https://api.openai.com/auth"];
}
function extractAccountId(token) {
	const auth = decodeJwtPayload(token)?.["https://api.openai.com/auth"];
	if (!auth || typeof auth !== "object") return void 0;
	const id = auth.chatgpt_account_id;
	return typeof id === "string" && id.trim().length > 0 ? id.trim() : void 0;
}
async function resolveOpenAIAuth(ctx) {
	if (ctx) {
		const { getModel } = await import("@earendil-works/pi-ai/compat");
		for (const candidate of AUTH_MODEL_CANDIDATES) for (const modelId of candidate.models) {
			const model = getModel(candidate.provider, modelId);
			if (!model) continue;
			try {
				const resolved = await ctx.modelRegistry.getApiKeyAndHeaders(model);
				if (resolved.ok && resolved.apiKey) return {
					provider: candidate.provider,
					apiKey: resolved.apiKey,
					model: modelId,
					headers: resolved.headers ?? {}
				};
			} catch {}
		}
	}
	const apiKey = normalizeApiKey(process.env.OPENAI_API_KEY) ?? normalizeApiKey(loadConfig().openaiApiKey);
	return apiKey ? {
		provider: "openai",
		apiKey,
		model: "gpt-5.4",
		headers: {}
	} : void 0;
}
async function isOpenAISearchAvailable(ctx) {
	return !!await resolveOpenAIAuth(ctx);
}
function buildInstructions(options) {
	const lines = ["Search the web and return a concise answer grounded only in the web results.", "Include clickable source citations in the response text when possible."];
	if (options.recencyFilter) lines.push(`Prefer sources from the ${{
		day: "past 24 hours",
		week: "past week",
		month: "past month",
		year: "past year"
	}[options.recencyFilter]}.`);
	if (typeof options.numResults === "number" && Number.isFinite(options.numResults) && options.numResults > 0) lines.push(`Prefer around ${Math.min(Math.floor(options.numResults), 20)} distinct sources.`);
	const filters = normalizeDomainFilters(options.domainFilter);
	if (filters?.allowedDomains?.length) lines.push(`Only use sources from: ${filters.allowedDomains.join(", ")}.`);
	if (filters?.blockedDomains?.length) lines.push(`Do not use sources from: ${filters.blockedDomains.join(", ")}.`);
	return lines.join(" ");
}
function buildWebSearchTool(options) {
	const tool = { type: "web_search" };
	const filters = normalizeDomainFilters(options.domainFilter);
	if (filters) tool.filters = {
		...filters.allowedDomains ? { allowed_domains: filters.allowedDomains } : {},
		...filters.blockedDomains ? { blocked_domains: filters.blockedDomains } : {}
	};
	return tool;
}
async function parseOpenAIResponse(response) {
	const text = await response.text();
	const trimmed = text.trim();
	if (trimmed.startsWith("{") || trimmed.startsWith("[")) try {
		const parsed = JSON.parse(trimmed);
		if (Array.isArray(parsed)) return { output: parsed };
		return parsed && typeof parsed === "object" ? parsed : { output: [] };
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		throw new Error(`OpenAI API returned invalid JSON: ${message}`);
	}
	const outputItems = [];
	let completedResponse = null;
	for (const line of text.split("\n")) {
		if (!line.startsWith("data: ")) continue;
		const data = line.slice(6).trim();
		if (!data || data === "[DONE]") continue;
		try {
			const parsed = JSON.parse(data);
			if (parsed.type === "response.output_item.done" && parsed.item) outputItems.push(parsed.item);
			if ((parsed.type === "response.done" || parsed.type === "response.completed") && parsed.response && typeof parsed.response === "object") completedResponse = parsed.response;
		} catch {}
	}
	if (completedResponse) return (Array.isArray(completedResponse.output) ? completedResponse.output : []).length > 0 ? completedResponse : {
		...completedResponse,
		output: outputItems
	};
	if (outputItems.length > 0) return { output: outputItems };
	throw new Error("OpenAI API returned no parseable response output");
}
function cleanSourceUrl(rawUrl) {
	try {
		const url = new URL(rawUrl);
		if (url.searchParams.get("utm_source") === "openai") url.searchParams.delete("utm_source");
		return url.toString();
	} catch {
		return rawUrl.replace(/[?&]utm_source=openai$/, "");
	}
}
function extractSnippetAround(text, start, end) {
	if (typeof start !== "number" || typeof end !== "number" || !text) return "";
	const before = Math.max(0, start - 100);
	const after = Math.min(text.length, end + 100);
	const snippet = text.slice(before, after).replace(/\[([^\]]*)\]\([^)]*\)/g, "$1").trim();
	return snippet.length > 300 ? `${snippet.slice(0, 297)}...` : snippet;
}
function addResult(results, seen, url, title, snippet = "") {
	if (typeof url !== "string" || url.trim().length === 0) return;
	const cleanUrl = cleanSourceUrl(url);
	if (seen.has(cleanUrl)) return;
	seen.add(cleanUrl);
	results.push({
		title: typeof title === "string" && title.trim().length > 0 ? title : cleanUrl,
		url: cleanUrl,
		snippet
	});
}
function extractSearchResults(output, numResults) {
	const results = [];
	const seenUrls = /* @__PURE__ */ new Set();
	for (const item of output) {
		if (!item || typeof item !== "object" || item.type !== "message") continue;
		const content = item.content;
		if (!Array.isArray(content)) continue;
		for (const part of content) {
			if (!part || typeof part !== "object") continue;
			const text = typeof part.text === "string" ? part.text : "";
			const annotations = part.annotations;
			if (!Array.isArray(annotations)) continue;
			for (const annotation of annotations) {
				if (!annotation || typeof annotation !== "object" || annotation.type !== "url_citation") continue;
				addResult(results, seenUrls, annotation.url, annotation.title, extractSnippetAround(text, annotation.start_index, annotation.end_index));
			}
		}
	}
	for (const item of output) {
		if (!item || typeof item !== "object" || item.type !== "web_search_call") continue;
		const value = item;
		const sourceGroups = [
			value.action && typeof value.action === "object" ? value.action.sources : void 0,
			value.sources,
			value.results
		];
		for (const group of sourceGroups) {
			if (!Array.isArray(group)) continue;
			for (const source of group) {
				if (!source || typeof source !== "object") continue;
				const record = source;
				addResult(results, seenUrls, record.url ?? record.source_website_url, record.title ?? record.caption);
			}
		}
	}
	if (typeof numResults === "number" && Number.isFinite(numResults) && numResults > 0) return results.slice(0, Math.min(Math.floor(numResults), 20));
	return results;
}
function extractAnswer(output) {
	const parts = [];
	for (const item of output) {
		if (!item || typeof item !== "object" || item.type !== "message") continue;
		const content = item.content;
		if (!Array.isArray(content)) continue;
		for (const part of content) {
			if (!part || typeof part !== "object") continue;
			const text = part.text;
			if (typeof text === "string" && text.trim().length > 0) parts.push(text);
		}
	}
	return parts.join("\n").trim();
}
async function searchWithOpenAI(query, options = {}, ctx) {
	const auth = await resolveOpenAIAuth(ctx);
	if (!auth) throw new Error(`OpenAI web search unavailable. Either:
  1. Use /login to sign in with a Codex subscription
  2. Create ${CONFIG_PATH} with { "openaiApiKey": "your-key" }\n  3. Set OPENAI_API_KEY environment variable`);
	const activityId = activityMonitor.logStart({
		type: "api",
		query
	});
	const headers = {
		...auth.headers,
		Authorization: `Bearer ${auth.apiKey}`,
		"Content-Type": "application/json",
		"OpenAI-Beta": "responses=experimental"
	};
	const useCodexEndpoint = auth.provider === "openai-codex" || isCodexJwt(auth.apiKey);
	if (useCodexEndpoint) {
		const accountId = extractAccountId(auth.apiKey);
		if (accountId) headers["chatgpt-account-id"] = accountId;
		headers.originator = "pi";
	}
	const body = {
		model: auth.model,
		instructions: buildInstructions(options),
		input: [{
			role: "user",
			content: [{
				type: "input_text",
				text: query
			}]
		}],
		tools: [buildWebSearchTool(options)],
		include: ["web_search_call.action.sources"],
		store: false,
		stream: true,
		tool_choice: "required",
		parallel_tool_calls: true
	};
	try {
		const response = await fetch(useCodexEndpoint ? CODEX_RESPONSES_URL : OPENAI_RESPONSES_URL, {
			method: "POST",
			headers,
			body: JSON.stringify(body),
			signal: options.signal ? AbortSignal.any([AbortSignal.timeout(SEARCH_TIMEOUT_MS), options.signal]) : AbortSignal.timeout(SEARCH_TIMEOUT_MS)
		});
		if (!response.ok) {
			activityMonitor.logError(activityId, `HTTP ${response.status}`);
			const errorText = await response.text();
			throw new Error(`OpenAI API error ${response.status}: ${errorText.slice(0, 300)}`);
		}
		const parsed = await parseOpenAIResponse(response);
		const output = Array.isArray(parsed.output) ? parsed.output : [];
		const answer = extractAnswer(output);
		const results = extractSearchResults(output, options.numResults);
		if (!answer && results.length === 0) throw new Error("OpenAI web_search returned no answer or sources");
		activityMonitor.logComplete(activityId, response.status);
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
//#endregion
export { isOpenAISearchAvailable, resolveOpenAIAuth, searchWithOpenAI };

//# sourceMappingURL=openai-search-BBUbTQfw.mjs.map