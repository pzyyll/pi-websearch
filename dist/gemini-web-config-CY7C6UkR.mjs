import { r as getWebSearchConfigPath } from "./utils-_BNFawOs.mjs";
import { existsSync, readFileSync } from "node:fs";
//#region gemini-web-config.ts
const CONFIG_PATH = getWebSearchConfigPath();
let cachedConfig = null;
function normalizeChromeProfile(value) {
	if (typeof value !== "string") return void 0;
	const normalized = value.trim();
	return normalized.length > 0 ? normalized : void 0;
}
function loadConfig() {
	if (cachedConfig) return cachedConfig;
	if (!existsSync(CONFIG_PATH)) {
		cachedConfig = {};
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
	cachedConfig = {
		chromeProfile: normalizeChromeProfile(raw.chromeProfile),
		allowBrowserCookies: raw.allowBrowserCookies === true
	};
	return cachedConfig;
}
function getChromeProfileFromConfig() {
	return loadConfig().chromeProfile;
}
function isBrowserCookieAccessAllowed() {
	if (process.env.PI_ALLOW_BROWSER_COOKIES === "1" || process.env.FEYNMAN_ALLOW_BROWSER_COOKIES === "1") return true;
	return loadConfig().allowBrowserCookies === true;
}
//#endregion
export { isBrowserCookieAccessAllowed as n, normalizeChromeProfile as r, getChromeProfileFromConfig as t };

//# sourceMappingURL=gemini-web-config-CY7C6UkR.mjs.map