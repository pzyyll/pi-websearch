import { n as isBrowserCookieAccessAllowed, r as normalizeChromeProfile, t as getChromeProfileFromConfig } from "./gemini-web-config-CY7C6UkR.mjs";
import { homedir, platform, tmpdir } from "node:os";
import { basename, join } from "node:path";
import { createDecipheriv, pbkdf2Sync } from "node:crypto";
import { execFile } from "node:child_process";
import { copyFileSync, existsSync, mkdtempSync, rmSync } from "node:fs";
//#region chrome-cookies.ts
const GOOGLE_ORIGINS = [
	"https://gemini.google.com",
	"https://accounts.google.com",
	"https://www.google.com"
];
const ALL_COOKIE_NAMES = /* @__PURE__ */ new Set([
	"__Secure-1PSID",
	"__Secure-1PSIDTS",
	"__Secure-1PSIDCC",
	"__Secure-1PAPISID",
	"NID",
	"AEC",
	"SOCS",
	"__Secure-BUCKET",
	"__Secure-ENID",
	"SID",
	"HSID",
	"SSID",
	"APISID",
	"SAPISID",
	"__Secure-3PSID",
	"__Secure-3PSIDTS",
	"__Secure-3PAPISID",
	"SIDCC"
]);
const MACOS_BROWSER_CONFIGS = [
	{
		name: "Helium",
		baseDir: "Library/Application Support/net.imput.helium",
		keychainService: "Helium Storage Key",
		keychainAccount: "Helium"
	},
	{
		name: "Chrome",
		baseDir: "Library/Application Support/Google/Chrome",
		keychainService: "Chrome Safe Storage",
		keychainAccount: "Chrome"
	},
	{
		name: "Arc",
		baseDir: "Library/Application Support/Arc/User Data",
		keychainService: "Arc Safe Storage",
		keychainAccount: "Arc"
	}
];
const LINUX_BROWSER_CONFIGS = [{
	name: "Chromium",
	baseDir: ".config/chromium",
	secretToolApp: "chromium"
}, {
	name: "Chrome",
	baseDir: ".config/google-chrome",
	secretToolApp: "chrome"
}];
async function getGoogleCookies(options) {
	const currentPlatform = platform();
	const configs = currentPlatform === "darwin" ? MACOS_BROWSER_CONFIGS : currentPlatform === "linux" ? LINUX_BROWSER_CONFIGS : [];
	if (configs.length === 0) return null;
	const warnings = [];
	const profile = options?.profile ?? "Default";
	const hosts = GOOGLE_ORIGINS.map((origin) => new URL(origin).hostname);
	for (const config of configs) {
		const cookiesPath = join(homedir(), config.baseDir, profile, "Cookies");
		if (!existsSync(cookiesPath)) continue;
		const password = await readBrowserPassword(config, currentPlatform);
		if (!password) {
			warnings.push(`Could not read ${config.name} cookie encryption password`);
			continue;
		}
		const key = pbkdf2Sync(password, "saltysalt", currentPlatform === "darwin" ? 1003 : 1, 16, "sha1");
		const tempDir = mkdtempSync(join(tmpdir(), "pi-chrome-cookies-"));
		try {
			const tempDb = join(tempDir, "Cookies");
			copyFileSync(cookiesPath, tempDb);
			copySidecar(cookiesPath, tempDb, "-wal");
			copySidecar(cookiesPath, tempDb, "-shm");
			const stripHash = await readMetaVersion(tempDb) >= 24;
			const rows = await queryCookieRows(tempDb, hosts);
			if (!rows) {
				warnings.push(`Failed to query ${config.name} cookie database`);
				continue;
			}
			const cookies = {};
			for (const row of rows) {
				const name = row.name;
				if (!ALL_COOKIE_NAMES.has(name)) continue;
				if (cookies[name]) continue;
				let value = typeof row.value === "string" && row.value.length > 0 ? row.value : null;
				if (!value) {
					const encrypted = row.encrypted_value;
					if (encrypted instanceof Uint8Array) value = decryptCookieValue(encrypted, key, stripHash);
				}
				if (value) cookies[name] = value;
			}
			if (options?.requiredCookies?.length && !options.requiredCookies.every((name) => Boolean(cookies[name]))) continue;
			return {
				cookies,
				warnings
			};
		} finally {
			rmSync(tempDir, {
				recursive: true,
				force: true
			});
		}
	}
	return null;
}
function decryptCookieValue(encrypted, key, stripHash) {
	const buf = Buffer.from(encrypted);
	if (buf.length < 3) return null;
	const prefix = buf.subarray(0, 3).toString("utf8");
	if (!/^v\d\d$/.test(prefix)) return null;
	const ciphertext = buf.subarray(3);
	if (!ciphertext.length) return "";
	try {
		const decipher = createDecipheriv("aes-128-cbc", key, Buffer.alloc(16, 32));
		decipher.setAutoPadding(false);
		const unpadded = removePkcs7Padding(Buffer.concat([decipher.update(ciphertext), decipher.final()]));
		const bytes = stripHash && unpadded.length >= 32 ? unpadded.subarray(32) : unpadded;
		const decoded = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
		let i = 0;
		while (i < decoded.length && decoded.charCodeAt(i) < 32) i++;
		return decoded.slice(i);
	} catch {
		return null;
	}
}
function removePkcs7Padding(buf) {
	if (!buf.length) return buf;
	const padding = buf[buf.length - 1];
	if (!padding || padding > 16) return buf;
	return buf.subarray(0, buf.length - padding);
}
function readBrowserPassword(config, currentPlatform) {
	if (currentPlatform === "darwin") {
		if (!config.keychainAccount || !config.keychainService) return Promise.resolve(null);
		return readKeychainPassword(config.keychainAccount, config.keychainService);
	}
	if (currentPlatform === "linux") return readLinuxPassword(config.secretToolApp);
	return Promise.resolve(null);
}
function readKeychainPassword(account, service) {
	return new Promise((resolve) => {
		execFile("security", [
			"find-generic-password",
			"-w",
			"-a",
			account,
			"-s",
			service
		], { timeout: 5e3 }, (err, stdout) => {
			if (err) {
				resolve(null);
				return;
			}
			resolve(stdout.trim() || null);
		});
	});
}
function readLinuxPassword(secretToolApp) {
	if (!secretToolApp) return Promise.resolve("peanuts");
	return new Promise((resolve) => {
		execFile("secret-tool", [
			"lookup",
			"application",
			secretToolApp
		], { timeout: 5e3 }, (err, stdout) => {
			if (err) {
				resolve("peanuts");
				return;
			}
			resolve(stdout.trim() || "peanuts");
		});
	});
}
let sqliteModule = null;
async function importSqlite() {
	if (sqliteModule) return sqliteModule;
	const orig = process.emitWarning.bind(process);
	process.emitWarning = ((warning, ...args) => {
		if ((typeof warning === "string" ? warning : warning?.message ?? "").includes("SQLite is an experimental feature")) return;
		return orig(warning, ...args);
	});
	try {
		sqliteModule = await import("node:sqlite");
		return sqliteModule;
	} catch {
		return null;
	} finally {
		process.emitWarning = orig;
	}
}
function supportsReadBigInts() {
	const [major, minor] = process.versions.node.split(".").map(Number);
	if (major > 24) return true;
	if (major < 24) return false;
	return minor >= 4;
}
async function readMetaVersion(dbPath) {
	const sqlite = await importSqlite();
	if (!sqlite) return 0;
	const opts = { readOnly: true };
	if (supportsReadBigInts()) opts.readBigInts = true;
	const db = new sqlite.DatabaseSync(dbPath, opts);
	try {
		const val = db.prepare("SELECT value FROM meta WHERE key = 'version'").all()[0]?.value;
		if (typeof val === "number") return Math.floor(val);
		if (typeof val === "bigint") return Number(val);
		if (typeof val === "string") return parseInt(val, 10) || 0;
		return 0;
	} catch {
		return 0;
	} finally {
		db.close();
	}
}
async function queryCookieRows(dbPath, hosts) {
	const sqlite = await importSqlite();
	if (!sqlite) return null;
	const clauses = [];
	for (const host of hosts) for (const candidate of expandHosts(host)) {
		const esc = candidate.replaceAll("'", "''");
		clauses.push(`host_key = '${esc}'`);
		clauses.push(`host_key = '.${esc}'`);
		clauses.push(`host_key LIKE '%.${esc}'`);
	}
	const where = clauses.join(" OR ");
	const opts = { readOnly: true };
	if (supportsReadBigInts()) opts.readBigInts = true;
	const db = new sqlite.DatabaseSync(dbPath, opts);
	try {
		return db.prepare(`SELECT name, value, host_key, encrypted_value FROM cookies WHERE (${where}) ORDER BY expires_utc DESC`).all();
	} catch {
		return null;
	} finally {
		db.close();
	}
}
function expandHosts(host) {
	const parts = host.split(".").filter(Boolean);
	if (parts.length <= 1) return [host];
	const candidates = /* @__PURE__ */ new Set();
	candidates.add(host);
	for (let i = 1; i <= parts.length - 2; i++) {
		const c = parts.slice(i).join(".");
		if (c) candidates.add(c);
	}
	return Array.from(candidates);
}
function copySidecar(srcDb, targetDb, suffix) {
	const sidecar = `${srcDb}${suffix}`;
	if (!existsSync(sidecar)) return;
	try {
		copyFileSync(sidecar, `${targetDb}${suffix}`);
	} catch {}
}
//#endregion
//#region gemini-web.ts
const GEMINI_APP_URL = "https://gemini.google.com/app";
const GEMINI_STREAM_GENERATE_URL = "https://gemini.google.com/_/BardChatUi/data/assistant.lamda.BardFrontendService/StreamGenerate";
const GEMINI_UPLOAD_URL = "https://content-push.googleapis.com/upload";
const GEMINI_UPLOAD_PUSH_ID = "feeds/mcudyrk2a4khkz";
const GOOGLE_LIST_ACCOUNTS_URL = "https://accounts.google.com/ListAccounts?gpsia=1&source=ChromiumBrowser&laf=b64bin&json=standard";
const USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
const MODEL_HEADER_NAME = "x-goog-ext-525001261-jspb";
const MODEL_HEADERS = {
	"gemini-3-pro": "[1,null,null,null,\"9d8ca3786ebdfbea\",null,null,0,[4]]",
	"gemini-2.5-pro": "[1,null,null,null,\"4af6c7f5da75d65d\",null,null,0,[4]]",
	"gemini-2.5-flash": "[1,null,null,null,\"9ec249fc9ad08861\",null,null,0,[4]]"
};
const REQUIRED_COOKIES = ["__Secure-1PSID", "__Secure-1PSIDTS"];
async function isGeminiWebAvailable(chromeProfile) {
	if (!isBrowserCookieAccessAllowed()) return null;
	const result = await getGoogleCookies({
		profile: normalizeChromeProfile(chromeProfile) ?? getChromeProfileFromConfig(),
		requiredCookies: REQUIRED_COOKIES
	});
	if (!result) return null;
	return result.cookies;
}
async function getActiveGoogleEmail(cookies) {
	const cookieHeader = buildCookieHeader(cookies);
	if (!cookieHeader) return null;
	try {
		const email = extractEmailFromGeminiHtml(await fetchWithCookieRedirects(GEMINI_APP_URL, cookieHeader, 10, AbortSignal.timeout(1e4)));
		if (email) return email;
	} catch {}
	try {
		return extractEmailFromListAccounts(await fetchWithCookieRedirects(GOOGLE_LIST_ACCOUNTS_URL, cookieHeader, 10, AbortSignal.timeout(1e4)));
	} catch {
		return null;
	}
}
async function queryWithCookies(prompt, cookieMap, options = {}) {
	const model = options.model && MODEL_HEADERS[options.model] ? options.model : "gemini-2.5-flash";
	const timeoutMs = options.timeoutMs ?? 12e4;
	let fullPrompt = prompt;
	if (options.youtubeUrl) fullPrompt = `${fullPrompt}\n\nYouTube video: ${options.youtubeUrl}`;
	const result = await runGeminiWebOnce(fullPrompt, cookieMap, model, options.files, timeoutMs, options.signal);
	if (isModelUnavailable(result.errorCode) && model !== "gemini-2.5-flash") {
		const fallback = await runGeminiWebOnce(fullPrompt, cookieMap, "gemini-2.5-flash", options.files, timeoutMs, options.signal);
		if (fallback.errorMessage) throw new Error(fallback.errorMessage);
		if (!fallback.text) throw new Error("Gemini Web returned empty response (fallback model)");
		return fallback.text;
	}
	if (result.errorMessage) throw new Error(result.errorMessage);
	if (!result.text) throw new Error("Gemini Web returned empty response");
	return result.text;
}
async function runGeminiWebOnce(prompt, cookieMap, model, files, timeoutMs, signal) {
	const effectiveSignal = withTimeout(signal, timeoutMs);
	const cookieHeader = buildCookieHeader(cookieMap);
	const accessToken = await fetchAccessToken(cookieHeader, effectiveSignal);
	const uploaded = [];
	if (files) for (const filePath of files) uploaded.push(await uploadFile(filePath, cookieHeader, effectiveSignal));
	const fReq = buildFReqPayload(prompt, uploaded);
	const params = new URLSearchParams();
	params.set("at", accessToken);
	params.set("f.req", fReq);
	const res = await fetch(GEMINI_STREAM_GENERATE_URL, {
		method: "POST",
		headers: {
			"content-type": "application/x-www-form-urlencoded;charset=utf-8",
			host: "gemini.google.com",
			origin: "https://gemini.google.com",
			referer: "https://gemini.google.com/",
			"x-same-domain": "1",
			"user-agent": USER_AGENT,
			cookie: cookieHeader,
			[MODEL_HEADER_NAME]: MODEL_HEADERS[model]
		},
		body: params.toString(),
		signal: effectiveSignal
	});
	const rawText = await res.text();
	if (!res.ok) return {
		text: "",
		errorMessage: `Gemini request failed: ${res.status}`
	};
	try {
		return parseStreamGenerateResponse(rawText);
	} catch (err) {
		let errorCode;
		try {
			errorCode = extractErrorCode(JSON.parse(trimJsonEnvelope(rawText)));
		} catch {}
		return {
			text: "",
			errorCode,
			errorMessage: err instanceof Error ? err.message : String(err)
		};
	}
}
async function fetchAccessToken(cookieHeader, signal) {
	const html = await fetchWithCookieRedirects(GEMINI_APP_URL, cookieHeader, 10, signal);
	for (const key of ["SNlM0e", "thykhd"]) {
		const match = html.match(new RegExp(`"${key}":"(.*?)"`));
		if (match?.[1]) return match[1];
	}
	throw new Error("Unable to authenticate with Gemini. Make sure you're signed into gemini.google.com in a supported Chromium-based browser.");
}
async function fetchWithCookieRedirects(url, cookieHeader, maxRedirects, signal) {
	let current = url;
	for (let i = 0; i <= maxRedirects; i++) {
		const res = await fetch(current, {
			headers: {
				"user-agent": USER_AGENT,
				cookie: cookieHeader
			},
			redirect: "manual",
			signal
		});
		if (res.status >= 300 && res.status < 400) {
			const location = res.headers.get("location");
			if (location) {
				current = new URL(location, current).toString();
				continue;
			}
		}
		return await res.text();
	}
	throw new Error(`Too many redirects (>${maxRedirects})`);
}
function extractEmailFromGeminiHtml(html) {
	for (const pattern of [
		/"oPEP7c"\s*:\s*"([^"]+)"/,
		/aria-label="Google Account:[^"]*?\(([^)]+)\)"/,
		/"displayEmail"\s*:\s*"([^"]+)"/,
		/"defaultEmail"\s*:\s*"([^"]+)"/,
		/"email"\s*:\s*"([^"]+)"/,
		/"identifier"\s*:\s*"([^"]+)"/,
		/"gaiaIdentifier"\s*:\s*"([^"]+)"/
	]) {
		const email = normalizeEmail(html.match(pattern)?.[1]);
		if (email) return email;
	}
	return findFirstEmail(html);
}
function extractEmailFromListAccounts(text) {
	const trimmed = text.replace(/^\)\]\}'\s*/, "");
	try {
		return findEmailInValue(JSON.parse(trimmed)) ?? findFirstEmail(trimmed);
	} catch {
		return findFirstEmail(trimmed);
	}
}
function findEmailInValue(value) {
	if (typeof value === "string") return normalizeEmail(value);
	if (Array.isArray(value)) {
		for (const item of value) {
			const email = findEmailInValue(item);
			if (email) return email;
		}
		return null;
	}
	if (value && typeof value === "object") for (const item of Object.values(value)) {
		const email = findEmailInValue(item);
		if (email) return email;
	}
	return null;
}
function findFirstEmail(text) {
	return decodeEmailEscapes(text).match(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i)?.[0] ?? null;
}
function normalizeEmail(value) {
	if (!value) return null;
	const normalized = decodeEmailEscapes(value.trim());
	return /^[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}$/i.test(normalized) ? normalized : null;
}
function decodeEmailEscapes(value) {
	return value.replace(/\\u0040/gi, "@").replace(/\\x40/gi, "@").replace(/&#64;/gi, "@").replace(/&commat;/gi, "@").replace(/\\"/g, "\"").replace(/\\\\/g, "\\");
}
async function uploadFile(filePath, cookieHeader, signal) {
	const data = readFileSync(filePath);
	const fileName = basename(filePath);
	const boundary = "----FormBoundary" + Math.random().toString(36).slice(2);
	const header = `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${fileName}"\r\nContent-Type: application/octet-stream\r\n\r\n`;
	const footer = `\r\n--${boundary}--\r\n`;
	const body = Buffer.concat([
		Buffer.from(header, "utf-8"),
		data,
		Buffer.from(footer, "utf-8")
	]);
	const res = await fetch(GEMINI_UPLOAD_URL, {
		method: "POST",
		headers: {
			"content-type": `multipart/form-data; boundary=${boundary}`,
			"push-id": GEMINI_UPLOAD_PUSH_ID,
			"user-agent": USER_AGENT,
			cookie: cookieHeader
		},
		body,
		signal
	});
	if (!res.ok) {
		const text = await res.text();
		throw new Error(`File upload failed: ${res.status} (${text.slice(0, 200)})`);
	}
	return {
		id: await res.text(),
		name: fileName
	};
}
function buildFReqPayload(prompt, uploaded) {
	const innerList = [
		uploaded.length > 0 ? [
			prompt,
			0,
			null,
			uploaded.map((file) => [[file.id, 1]])
		] : [prompt],
		null,
		null
	];
	return JSON.stringify([null, JSON.stringify(innerList)]);
}
function withTimeout(signal, timeoutMs) {
	const timeout = AbortSignal.timeout(timeoutMs);
	return signal ? AbortSignal.any([signal, timeout]) : timeout;
}
function buildCookieHeader(cookieMap) {
	return Object.entries(cookieMap).filter(([, value]) => typeof value === "string" && value.length > 0).map(([name, value]) => `${name}=${value}`).join("; ");
}
function getNestedValue(value, pathParts) {
	let current = value;
	for (const part of pathParts) {
		if (current == null) return void 0;
		if (!Array.isArray(current)) return void 0;
		current = current[part];
	}
	return current;
}
function trimJsonEnvelope(text) {
	const start = text.indexOf("[");
	const end = text.lastIndexOf("]");
	if (start === -1 || end === -1 || end <= start) throw new Error("Gemini response did not contain a JSON payload.");
	return text.slice(start, end + 1);
}
function extractErrorCode(responseJson) {
	const code = getNestedValue(responseJson, [
		0,
		5,
		2,
		0,
		1,
		0
	]);
	return typeof code === "number" && code >= 0 ? code : void 0;
}
function isModelUnavailable(errorCode) {
	return errorCode === 1052;
}
function extractCandidateText(candidate) {
	const textRaw = getNestedValue(candidate, [1, 0]);
	let text = typeof textRaw === "string" ? textRaw : "";
	if (/^http:\/\/googleusercontent\.com\/card_content\/\d+/.test(text)) {
		const alt = getNestedValue(candidate, [22, 0]);
		if (typeof alt === "string" && alt.length > 0) text = alt;
	}
	return text;
}
function parseStreamGenerateResponse(rawText) {
	const responseJson = JSON.parse(trimJsonEnvelope(rawText));
	const errorCode = extractErrorCode(responseJson);
	const parts = Array.isArray(responseJson) ? responseJson : [];
	let firstCandidateSeen = void 0;
	let latestNonEmptyText = "";
	for (let i = 0; i < parts.length; i++) {
		const partBody = getNestedValue(parts[i], [2]);
		if (!partBody || typeof partBody !== "string") continue;
		try {
			const candidateList = getNestedValue(JSON.parse(partBody), [4]);
			if (!Array.isArray(candidateList) || candidateList.length === 0) continue;
			const firstCandidate = candidateList[0];
			if (firstCandidateSeen === void 0) firstCandidateSeen = firstCandidate;
			const text = extractCandidateText(firstCandidate);
			if (text.length > 0) latestNonEmptyText = text;
		} catch {}
	}
	return {
		text: latestNonEmptyText.length > 0 ? latestNonEmptyText : extractCandidateText(firstCandidateSeen),
		errorCode
	};
}
//#endregion
export { getActiveGoogleEmail, isGeminiWebAvailable, queryWithCookies };

//# sourceMappingURL=gemini-web-BcCxdxzO.mjs.map