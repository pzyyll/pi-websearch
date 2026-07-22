import { r as getWebSearchConfigPath } from "./utils-_BNFawOs.mjs";
import { existsSync, readFileSync } from "node:fs";
//#region gemini-api.ts
const DEFAULT_API_HOST = "https://generativelanguage.googleapis.com";
const API_VERSION = "v1beta";
const API_BASE = `${DEFAULT_API_HOST}/${API_VERSION}`;
const CONFIG_PATH = getWebSearchConfigPath();
const DEFAULT_MODEL = "gemini-3-flash-preview";
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
function withTimeout(signal, timeoutMs) {
	const timeout = AbortSignal.timeout(timeoutMs);
	return signal ? AbortSignal.any([signal, timeout]) : timeout;
}
function normalizeApiKey(value) {
	if (typeof value !== "string") return null;
	const normalized = value.trim();
	return normalized.length > 0 ? normalized : null;
}
function normalizeBaseUrl(value) {
	if (typeof value !== "string") return null;
	const normalized = value.trim().replace(/\/+$/, "");
	return normalized.length > 0 ? normalized : null;
}
function isCloudflareGateway() {
	return getApiHost().includes("gateway.ai.cloudflare.com");
}
function getApiKey() {
	return normalizeApiKey(process.env.GEMINI_API_KEY) ?? normalizeApiKey(loadConfig().geminiApiKey);
}
function getApiHost() {
	return normalizeBaseUrl(process.env.GOOGLE_GEMINI_BASE_URL) ?? normalizeBaseUrl(loadConfig().geminiBaseUrl) ?? DEFAULT_API_HOST;
}
function getVersionedApiBase() {
	return `${getApiHost()}/${API_VERSION}`;
}
function buildKeyParam(apiKey) {
	if (!apiKey || isCloudflareGateway()) return "";
	return `?key=${apiKey}`;
}
function getCloudflareApiKey() {
	return normalizeApiKey(process.env.CLOUDFLARE_API_KEY) ?? normalizeApiKey(loadConfig().cloudflareApiKey);
}
function isGatewayConfigured() {
	return isCloudflareGateway() && getCloudflareApiKey() !== null;
}
function buildAuthHeaders() {
	if (!isCloudflareGateway()) return {};
	const cloudflareApiKey = getCloudflareApiKey();
	return cloudflareApiKey ? { "cf-aig-authorization": `Bearer ${cloudflareApiKey}` } : {};
}
function isGeminiApiAvailable() {
	return getApiKey() !== null || isGatewayConfigured();
}
async function queryGeminiApiWithVideo(prompt, videoUri, options = {}) {
	const apiKey = getApiKey();
	if (!apiKey && !isGatewayConfigured()) throw new Error(`Gemini API not configured. Either:
  1. Set GEMINI_API_KEY in ${CONFIG_PATH}\n  2. Set GOOGLE_GEMINI_BASE_URL + CLOUDFLARE_API_KEY for Cloudflare AI Gateway routing`);
	const model = options.model ?? "gemini-3-flash-preview";
	const signal = withTimeout(options.signal, options.timeoutMs ?? 12e4);
	const url = `${getVersionedApiBase()}/models/${model}:generateContent${buildKeyParam(apiKey)}`;
	const fileData = { fileUri: videoUri };
	if (options.mimeType) fileData.mimeType = options.mimeType;
	const body = { contents: [{
		role: "user",
		parts: [{ fileData }, { text: prompt }]
	}] };
	const res = await fetch(url, {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
			...buildAuthHeaders()
		},
		body: JSON.stringify(body),
		signal
	});
	if (!res.ok) {
		const errorText = await res.text();
		throw new Error(`Gemini API error ${res.status}: ${errorText.slice(0, 300)}`);
	}
	const text = (await res.json()).candidates?.[0]?.content?.parts?.map((p) => p.text).filter(Boolean).join("\n");
	if (!text) throw new Error("Gemini API returned empty response");
	return text;
}
//#endregion
export { API_BASE, DEFAULT_MODEL, buildAuthHeaders, buildKeyParam, getApiHost, getApiKey, getCloudflareApiKey, getVersionedApiBase, isGatewayConfigured, isGeminiApiAvailable, queryGeminiApiWithVideo };

//# sourceMappingURL=gemini-api-3ZthksRh.mjs.map