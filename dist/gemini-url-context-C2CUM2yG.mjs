import { t as activityMonitor } from "./activity-Y0iQoAlM.mjs";
import { extractHeadingTitle } from "./extract-BEAF-bqd.mjs";
import { DEFAULT_MODEL, buildAuthHeaders, buildKeyParam, getApiKey, getVersionedApiBase, isGatewayConfigured } from "./gemini-api-3ZthksRh.mjs";
import { isGeminiWebAvailable, queryWithCookies } from "./gemini-web-BcCxdxzO.mjs";
//#region gemini-url-context.ts
const EXTRACTION_PROMPT = `Extract the complete readable content from this URL as clean markdown.
Include the page title, all text content, code blocks, and tables.
Do not summarize — extract the full content.

URL: `;
function shouldRethrow(err) {
	return (err instanceof Error ? err.message : String(err)).startsWith("Failed to parse ");
}
async function extractWithUrlContext(url, signal) {
	const apiKey = getApiKey();
	if (!apiKey && !isGatewayConfigured()) return null;
	const activityId = activityMonitor.logStart({
		type: "api",
		query: `url_context: ${url}`
	});
	try {
		const model = DEFAULT_MODEL;
		const body = {
			contents: [{
				role: "user",
				parts: [{ text: EXTRACTION_PROMPT + url }]
			}],
			tools: [{ url_context: {} }]
		};
		const res = await fetch(`${getVersionedApiBase()}/models/${model}:generateContent${buildKeyParam(apiKey)}`, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				...buildAuthHeaders()
			},
			body: JSON.stringify(body),
			signal: AbortSignal.any([AbortSignal.timeout(6e4), ...signal ? [signal] : []])
		});
		if (!res.ok) {
			activityMonitor.logComplete(activityId, res.status);
			return null;
		}
		const data = await res.json();
		activityMonitor.logComplete(activityId, res.status);
		const metadata = data.candidates?.[0]?.url_context_metadata;
		if (metadata?.url_metadata?.length) {
			const status = metadata.url_metadata[0].url_retrieval_status;
			if (status === "URL_RETRIEVAL_STATUS_UNSAFE" || status === "URL_RETRIEVAL_STATUS_ERROR") return null;
		}
		const content = data.candidates?.[0]?.content?.parts?.map((p) => p.text).filter(Boolean).join("\n") ?? "";
		if (!content || content.length < 50) return null;
		return {
			url,
			title: extractTitleFromContent(content, url),
			content,
			error: null
		};
	} catch (err) {
		if (shouldRethrow(err)) throw err;
		const message = err instanceof Error ? err.message : String(err);
		if (message.toLowerCase().includes("abort")) activityMonitor.logComplete(activityId, 0);
		else activityMonitor.logError(activityId, message);
		return null;
	}
}
async function extractWithGeminiWeb(url, signal) {
	const cookies = await isGeminiWebAvailable();
	if (!cookies) return null;
	const activityId = activityMonitor.logStart({
		type: "api",
		query: `gemini_web: ${url}`
	});
	try {
		const text = await queryWithCookies(EXTRACTION_PROMPT + url, cookies, {
			model: "gemini-3-flash-preview",
			signal,
			timeoutMs: 6e4
		});
		activityMonitor.logComplete(activityId, 200);
		if (!text || text.length < 50) return null;
		return {
			url,
			title: extractTitleFromContent(text, url),
			content: text,
			error: null
		};
	} catch (err) {
		if (shouldRethrow(err)) throw err;
		const message = err instanceof Error ? err.message : String(err);
		if (message.toLowerCase().includes("abort")) activityMonitor.logComplete(activityId, 0);
		else activityMonitor.logError(activityId, message);
		return null;
	}
}
function extractTitleFromContent(text, url) {
	return extractHeadingTitle(text) ?? (new URL(url).pathname.split("/").pop() || url);
}
//#endregion
export { extractWithGeminiWeb, extractWithUrlContext };

//# sourceMappingURL=gemini-url-context-C2CUM2yG.mjs.map