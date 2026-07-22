import { r as getWebSearchConfigPath, t as formatSeconds } from "./utils-_BNFawOs.mjs";
import { t as activityMonitor } from "./activity-Y0iQoAlM.mjs";
import { existsSync, readFileSync } from "node:fs";
import pLimit from "p-limit";
import { lookup } from "node:dns/promises";
import net from "node:net";
//#region ssrf-protection.ts
const DEFAULT_MAX_REDIRECTS = 5;
const REDIRECT_STATUSES = /* @__PURE__ */ new Set([
	301,
	302,
	303,
	307,
	308
]);
async function defaultLookup(hostname) {
	return lookup(hostname, {
		all: true,
		verbatim: true
	});
}
async function validateRemoteUrl(rawUrl, options = {}) {
	const url = rawUrl instanceof URL ? rawUrl : new URL(rawUrl);
	if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error("Only HTTP and HTTPS URLs can be fetched remotely");
	const hostname = normalizeHostname(url.hostname);
	if (!hostname) throw new Error("URL must include a hostname");
	if (hostname === "localhost" || hostname.endsWith(".localhost")) throw new Error(`Blocked internal hostname: ${hostname}`);
	const allowRanges = parseAllowRanges(options.allowRanges);
	if (net.isIP(hostname)) {
		assertPublicAddress(hostname, hostname, allowRanges);
		return url;
	}
	let addresses;
	try {
		addresses = await (options.lookup ?? defaultLookup)(hostname);
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		throw new Error(`Failed to resolve ${hostname}: ${message}`);
	}
	if (addresses.length === 0) throw new Error(`Failed to resolve ${hostname}: no addresses returned`);
	for (const { address } of addresses) assertPublicAddress(address, hostname, allowRanges);
	return url;
}
async function fetchRemoteUrl(url, init = {}, options = {}) {
	const fetchImpl = options.fetch ?? fetch;
	const maxRedirects = options.maxRedirects ?? DEFAULT_MAX_REDIRECTS;
	let current = await validateRemoteUrl(url, options);
	let requestInit = init;
	for (let redirects = 0; redirects <= maxRedirects; redirects++) {
		const response = await fetchImpl(current, {
			...requestInit,
			redirect: "manual"
		});
		if (!REDIRECT_STATUSES.has(response.status)) return response;
		const location = response.headers.get("location");
		if (!location) return response;
		if (redirects === maxRedirects) throw new Error(`Too many redirects fetching ${current.toString()}`);
		current = await validateRemoteUrl(new URL(location, current), options);
		if (response.status === 303 || (response.status === 301 || response.status === 302) && requestInit.method?.toUpperCase() === "POST") {
			const { body: _body, ...nextInit } = requestInit;
			requestInit = {
				...nextInit,
				method: "GET"
			};
		}
	}
	throw new Error(`Too many redirects fetching ${current.toString()}`);
}
function normalizeHostname(hostname) {
	return hostname.toLowerCase().replace(/^\[|\]$/g, "").replace(/\.$/, "");
}
function assertPublicAddress(address, hostname, allowRanges = []) {
	const normalized = normalizeHostname(address);
	const ipVersion = net.isIP(normalized);
	if (ipVersion === 0) throw new Error(`Resolved non-IP address for ${hostname}: ${address}`);
	if (isInAllowedRange(normalized, ipVersion, allowRanges)) return;
	if (ipVersion === 4 && isBlockedIPv4(normalized)) throw new Error(`Blocked internal address for ${hostname}: ${normalized}`);
	if (ipVersion === 6 && isBlockedIPv6(normalized)) throw new Error(`Blocked internal address for ${hostname}: ${normalized}`);
}
function isBlockedIPv4(address) {
	const parts = address.split(".").map((part) => Number(part));
	if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return true;
	const [a, b] = parts;
	return a === 0 || a === 10 || a === 127 || a === 100 && b >= 64 && b <= 127 || a === 169 && b === 254 || a === 172 && b >= 16 && b <= 31 || a === 192 && b === 168 || a === 198 && (b === 18 || b === 19) || a >= 224;
}
function isBlockedIPv6(address) {
	const groups = parseIPv6(address);
	if (!groups) return true;
	const first = groups[0];
	if (groups.every((group) => group === 0)) return true;
	if (groups.slice(0, 7).every((group) => group === 0) && groups[7] === 1) return true;
	if ((first & 65024) === 64512) return true;
	if ((first & 65472) === 65152) return true;
	if (groups.slice(0, 5).every((group) => group === 0) && groups[5] === 65535) return isBlockedIPv4([
		groups[6] >> 8,
		groups[6] & 255,
		groups[7] >> 8,
		groups[7] & 255
	].join("."));
	return false;
}
function parseIPv6(address) {
	if (address.includes(".")) {
		const lastColon = address.lastIndexOf(":");
		const ipv4 = address.slice(lastColon + 1);
		if (net.isIP(ipv4) !== 4) return null;
		const octets = ipv4.split(".").map((part) => Number(part));
		address = `${address.slice(0, lastColon)}:${(octets[0] << 8 | octets[1]).toString(16)}:${(octets[2] << 8 | octets[3]).toString(16)}`;
	}
	const pieces = address.split("::");
	if (pieces.length > 2) return null;
	const left = pieces[0] ? pieces[0].split(":") : [];
	const right = pieces.length === 2 && pieces[1] ? pieces[1].split(":") : [];
	const missing = 8 - left.length - right.length;
	if (pieces.length === 1 && missing !== 0) return null;
	if (pieces.length === 2 && missing < 0) return null;
	const groups = [
		...left,
		...Array(missing).fill("0"),
		...right
	].map((part) => {
		if (!/^[0-9a-f]{1,4}$/i.test(part)) return -1;
		return parseInt(part, 16);
	});
	return groups.length === 8 && groups.every((group) => group >= 0 && group <= 65535) ? groups : null;
}
/** Parse `allowRanges` config value into validated CIDR rules. Throws on malformed entries. */
function parseAllowRanges(input) {
	if (input === void 0 || input === null) return [];
	if (!Array.isArray(input)) throw new Error("ssrf.allowRanges must be an array of CIDR strings");
	const rules = [];
	for (const entry of input) {
		if (typeof entry !== "string") throw new Error(`ssrf.allowRanges entries must be strings, got ${typeof entry}`);
		const rule = parseCidr(entry.trim());
		if (!rule) throw new Error(`Invalid CIDR notation in ssrf.allowRanges: "${entry}"`);
		rules.push(rule);
	}
	return rules;
}
/** Parse a single CIDR (e.g. "198.18.0.0/15", "fd00::/8") or bare host ("1.2.3.4"). Returns null if invalid. */
function parseCidr(raw) {
	if (!raw) return null;
	const slash = raw.lastIndexOf("/");
	const addrPart = slash >= 0 ? raw.slice(0, slash) : raw;
	const prefixPart = slash >= 0 ? raw.slice(slash + 1) : null;
	if (prefixPart !== null && !/^\d+$/.test(prefixPart)) return null;
	const version = net.isIP(addrPart);
	if (version === 4) {
		const bytes = ipv4ToBytes(addrPart);
		if (!bytes) return null;
		const prefix = prefixPart === null ? 32 : Number(prefixPart);
		if (!Number.isInteger(prefix) || prefix < 1 || prefix > 32) return null;
		return {
			bytes,
			prefix
		};
	}
	if (version === 6) {
		const groups = parseIPv6(addrPart);
		if (!groups) return null;
		const prefix = prefixPart === null ? 128 : Number(prefixPart);
		if (!Number.isInteger(prefix) || prefix < 1 || prefix > 128) return null;
		return {
			bytes: ipv6GroupsToBytes(groups),
			prefix
		};
	}
	return null;
}
function ipv4ToBytes(address) {
	const parts = address.split(".");
	if (parts.length !== 4) return null;
	const bytes = /* @__PURE__ */ new Uint8Array(4);
	for (let i = 0; i < 4; i++) {
		const octet = Number(parts[i]);
		if (!Number.isInteger(octet) || octet < 0 || octet > 255) return null;
		bytes[i] = octet;
	}
	return bytes;
}
function ipv6GroupsToBytes(groups) {
	const bytes = /* @__PURE__ */ new Uint8Array(16);
	for (let i = 0; i < 8; i++) {
		bytes[i * 2] = groups[i] >> 8;
		bytes[i * 2 + 1] = groups[i] & 255;
	}
	return bytes;
}
function ipToBytes(address, version) {
	if (version === 4) return ipv4ToBytes(address);
	if (version === 6) {
		const groups = parseIPv6(address);
		return groups ? ipv6GroupsToBytes(groups) : null;
	}
	return null;
}
/** True if `address` (already validated as `ipVersion`) falls within any allowed CIDR. */
function isInAllowedRange(address, ipVersion, allowRanges) {
	if (allowRanges.length === 0) return false;
	const addrBytes = ipToBytes(address, ipVersion);
	if (!addrBytes) return false;
	for (const rule of allowRanges) {
		if (rule.bytes.length !== addrBytes.length) continue;
		if (bytesMatchPrefix(addrBytes, rule.bytes, rule.prefix)) return true;
	}
	return false;
}
/** Compare the leading `prefix` bits of two equal-length byte arrays. */
function bytesMatchPrefix(addr, network, prefix) {
	const fullBytes = prefix >> 3;
	const remBits = prefix & 7;
	for (let i = 0; i < fullBytes; i++) if (addr[i] !== network[i]) return false;
	if (remBits > 0 && fullBytes < addr.length) {
		const mask = 255 << 8 - remBits & 255;
		if ((addr[fullBytes] & mask) !== (network[fullBytes] & mask)) return false;
	}
	return true;
}
//#endregion
//#region extract.ts
const DEFAULT_TIMEOUT_MS = 3e4;
const CONCURRENT_LIMIT = 3;
const NON_RECOVERABLE_ERRORS = ["Unsupported content type", "Response too large"];
const MIN_USEFUL_CONTENT = 500;
const WEB_SEARCH_CONFIG_PATH = getWebSearchConfigPath();
let htmlExtractMods;
let rscExtractMod;
let pdfExtractMod;
let githubExtractMod;
let youtubeExtractMod;
let geminiUrlContextMod;
let parallelMod;
let videoExtractMod;
function loadHtmlExtractMods() {
	return htmlExtractMods ??= (async () => {
		const [readabilityMod, linkedomMod, turndownMod] = await Promise.all([
			import("@mozilla/readability"),
			import("linkedom"),
			import("turndown")
		]);
		const TurndownService = turndownMod.default;
		return {
			Readability: readabilityMod.Readability,
			parseHTML: linkedomMod.parseHTML,
			turndown: new TurndownService({
				headingStyle: "atx",
				codeBlockStyle: "fenced"
			})
		};
	})();
}
function loadRscExtract() {
	return rscExtractMod ??= import("./rsc-extract-BEk9_U1k.mjs");
}
function loadPdfExtract() {
	return pdfExtractMod ??= import("./pdf-extract-Df0yVuK5.mjs");
}
function loadGithubExtract() {
	return githubExtractMod ??= import("./github-extract-Bi0A2_H3.mjs");
}
function loadYoutubeExtract() {
	return youtubeExtractMod ??= import("./youtube-extract-DdsNEHzS.mjs");
}
function loadGeminiUrlContext() {
	return geminiUrlContextMod ??= import("./gemini-url-context-C2CUM2yG.mjs");
}
function loadParallel() {
	return parallelMod ??= import("./parallel-VlcMu7qG.mjs");
}
function loadVideoExtract() {
	return videoExtractMod ??= import("./video-extract-DWZmU2wW.mjs");
}
/** Pure PDF sniff — kept local so isPDF does not pull unpdf via pdf-extract. */
function isPdfUrlOrContentType(url, contentType) {
	if (contentType?.includes("application/pdf")) return true;
	try {
		return new URL(url).pathname.toLowerCase().endsWith(".pdf");
	} catch {
		return false;
	}
}
/**
* Read `ssrf.allowRanges` (CIDR strings) from web-search.json. Returns [] when
* the file is missing, unreadable, or the key is unset so SSRF protection stays
* fully on by default. Throws when `ssrf.allowRanges` is present but not an array
* so a mistyped value (e.g. a bare string instead of a JSON array) fails loudly
* instead of being silently ignored. Exempts synthetic ranges used by TUN/fake-IP
* proxies (e.g. 198.18.0.0/15).
*/
function loadSsrfAllowRanges() {
	let value;
	try {
		if (!existsSync(WEB_SEARCH_CONFIG_PATH)) return [];
		const raw = readFileSync(WEB_SEARCH_CONFIG_PATH, "utf-8");
		value = JSON.parse(raw)?.ssrf?.allowRanges;
	} catch {
		return [];
	}
	if (value === void 0 || value === null) return [];
	if (!Array.isArray(value)) throw new Error(`ssrf.allowRanges in ${WEB_SEARCH_CONFIG_PATH} must be an array of CIDR strings`);
	const ranges = [];
	for (const [index, entry] of value.entries()) {
		if (typeof entry !== "string") throw new Error(`ssrf.allowRanges in ${WEB_SEARCH_CONFIG_PATH} must contain only CIDR strings; entry ${index + 1} is ${typeof entry}`);
		const trimmed = entry.trim();
		if (trimmed) ranges.push(trimmed);
	}
	return ranges;
}
function errorMessage(err) {
	return err instanceof Error ? err.message : String(err);
}
function isConfigParseError(err) {
	return errorMessage(err).startsWith("Failed to parse ");
}
function isAbortError(err) {
	return errorMessage(err).toLowerCase().includes("abort");
}
function abortedResult(url) {
	return {
		url,
		title: "",
		content: "",
		error: "Aborted"
	};
}
const fetchLimit = pLimit(CONCURRENT_LIMIT);
const JINA_READER_BASE = "https://r.jina.ai/";
const JINA_TIMEOUT_MS = 3e4;
async function extractWithJinaReader(url, signal, lookup) {
	const jinaUrl = JINA_READER_BASE + url;
	const activityId = activityMonitor.logStart({
		type: "api",
		query: `jina: ${url}`
	});
	try {
		await validateRemoteUrl(url, {
			allowRanges: loadSsrfAllowRanges(),
			lookup
		});
		const res = await fetch(jinaUrl, {
			headers: {
				"Accept": "text/markdown",
				"X-No-Cache": "true"
			},
			signal: AbortSignal.any([AbortSignal.timeout(JINA_TIMEOUT_MS), ...signal ? [signal] : []])
		});
		if (!res.ok) {
			activityMonitor.logComplete(activityId, res.status);
			return null;
		}
		const content = await res.text();
		activityMonitor.logComplete(activityId, res.status);
		const contentStart = content.indexOf("Markdown Content:");
		if (contentStart < 0) return null;
		const markdownPart = content.slice(contentStart + 17).trim();
		if (markdownPart.length < 100 || markdownPart.startsWith("Loading...") || markdownPart.startsWith("Please enable JavaScript")) return null;
		return {
			url,
			title: extractHeadingTitle(markdownPart) ?? (new URL(url).pathname.split("/").pop() || url),
			content: markdownPart,
			error: null
		};
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		if (message.toLowerCase().includes("abort")) activityMonitor.logComplete(activityId, 0);
		else activityMonitor.logError(activityId, message);
		return null;
	}
}
function parseTimestamp(ts) {
	const num = Number(ts);
	if (!isNaN(num) && num >= 0) return Math.floor(num);
	const parts = ts.split(":").map(Number);
	if (parts.some((p) => isNaN(p) || p < 0)) return null;
	if (parts.length === 3) return Math.floor(parts[0] * 3600 + parts[1] * 60 + parts[2]);
	if (parts.length === 2) return Math.floor(parts[0] * 60 + parts[1]);
	return null;
}
function parseTimestampSpec(ts) {
	const dashIdx = ts.indexOf("-", 1);
	if (dashIdx > 0) {
		const start = parseTimestamp(ts.slice(0, dashIdx));
		const end = parseTimestamp(ts.slice(dashIdx + 1));
		if (start !== null && end !== null && end > start) return {
			type: "range",
			start,
			end
		};
	}
	const seconds = parseTimestamp(ts);
	return seconds !== null ? {
		type: "single",
		seconds
	} : null;
}
const DEFAULT_RANGE_FRAMES = 6;
const MIN_FRAME_INTERVAL = 5;
function computeRangeTimestamps(start, end, maxFrames = DEFAULT_RANGE_FRAMES) {
	if (maxFrames <= 1) return [start];
	const idealInterval = (end - start) / (maxFrames - 1);
	if (idealInterval < MIN_FRAME_INTERVAL) {
		const timestamps = [];
		for (let t = start; t <= end && timestamps.length < maxFrames; t += MIN_FRAME_INTERVAL) timestamps.push(t);
		return timestamps;
	}
	return Array.from({ length: maxFrames }, (_, i) => Math.round(start + i * idealInterval));
}
function buildFrameResult(url, label, requestedCount, frames, error, duration) {
	if (frames.length === 0) {
		const msg = error ?? "Frame extraction failed";
		return {
			url,
			title: `Frames ${label} (0/${requestedCount})`,
			content: msg,
			error: msg
		};
	}
	return {
		url,
		title: `Frames ${label} (${frames.length}/${requestedCount})`,
		content: `${frames.length} frames extracted from ${label}`,
		error: null,
		frames,
		duration
	};
}
async function extractLocalFrames(filePath, timestamps) {
	const { extractVideoFrame } = await loadVideoExtract();
	const results = await Promise.all(timestamps.map(async (t) => {
		const frame = await extractVideoFrame(filePath, t);
		if ("error" in frame) return { error: frame.error };
		return {
			...frame,
			timestamp: formatSeconds(t)
		};
	}));
	const frames = results.filter((f) => "data" in f);
	const firstError = results.find((f) => "error" in f);
	return {
		frames,
		error: frames.length === 0 && firstError ? firstError.error : null
	};
}
async function safeVideoInfo(url) {
	try {
		const { isVideoFile } = await loadVideoExtract();
		return {
			info: isVideoFile(url),
			error: void 0
		};
	} catch (err) {
		return {
			info: null,
			error: errorMessage(err)
		};
	}
}
async function extractContent(url, signal, options) {
	if (signal?.aborted) return {
		url,
		title: "",
		content: "",
		error: "Aborted"
	};
	if (options?.frames && !options.timestamp) {
		const frameCount = options.frames;
		const { isYouTubeURL, getYouTubeStreamInfo, extractYouTubeFrames } = await loadYoutubeExtract();
		const ytInfo = isYouTubeURL(url);
		if (ytInfo.isYouTube && ytInfo.videoId) {
			const streamInfo = await getYouTubeStreamInfo(ytInfo.videoId);
			if ("error" in streamInfo) return {
				url,
				title: "Frames",
				content: streamInfo.error,
				error: streamInfo.error
			};
			if (streamInfo.duration === null) {
				const error = "Cannot determine video duration. Use a timestamp range instead.";
				return {
					url,
					title: "Frames",
					content: error,
					error
				};
			}
			const dur = Math.floor(streamInfo.duration);
			const timestamps = computeRangeTimestamps(0, dur, frameCount);
			const result = await extractYouTubeFrames(ytInfo.videoId, timestamps, streamInfo);
			return buildFrameResult(url, `${formatSeconds(0)}-${formatSeconds(dur)}`, timestamps.length, result.frames, result.error, streamInfo.duration);
		}
		const localVideo = await safeVideoInfo(url);
		if (localVideo.error) return {
			url,
			title: "",
			content: "",
			error: localVideo.error
		};
		if (localVideo.info) {
			const { getLocalVideoDuration } = await loadVideoExtract();
			const durationResult = await getLocalVideoDuration(localVideo.info.absolutePath);
			if (typeof durationResult !== "number") return {
				url,
				title: "Frames",
				content: durationResult.error,
				error: durationResult.error
			};
			const dur = Math.floor(durationResult);
			const timestamps = computeRangeTimestamps(0, dur, frameCount);
			const result = await extractLocalFrames(localVideo.info.absolutePath, timestamps);
			return buildFrameResult(url, `${formatSeconds(0)}-${formatSeconds(dur)}`, timestamps.length, result.frames, result.error, durationResult);
		}
		return {
			url,
			title: "",
			content: "",
			error: "Frame extraction only works with YouTube and local video files"
		};
	}
	if (options?.timestamp) {
		const spec = parseTimestampSpec(options.timestamp);
		if (!spec) return {
			url,
			title: "",
			content: "",
			error: `Invalid timestamp format: "${options.timestamp}". Use "H:MM:SS", "MM:SS", "85", or "start-end".`
		};
		const frameCount = options.frames;
		const { isYouTubeURL, getYouTubeStreamInfo, extractYouTubeFrames, extractYouTubeFrame } = await loadYoutubeExtract();
		const ytInfo = isYouTubeURL(url);
		if (ytInfo.isYouTube && ytInfo.videoId) {
			const streamInfo = await getYouTubeStreamInfo(ytInfo.videoId);
			if ("error" in streamInfo) {
				if (spec.type === "range") return {
					url,
					title: `Frames ${`${formatSeconds(spec.start)}-${formatSeconds(spec.end)}`}`,
					content: streamInfo.error,
					error: streamInfo.error
				};
				if (frameCount) {
					const end = spec.seconds + (frameCount - 1) * MIN_FRAME_INTERVAL;
					return {
						url,
						title: `Frames ${`${formatSeconds(spec.seconds)}-${formatSeconds(end)}`}`,
						content: streamInfo.error,
						error: streamInfo.error
					};
				}
				return {
					url,
					title: `Frame at ${options.timestamp}`,
					content: streamInfo.error,
					error: streamInfo.error
				};
			}
			if (spec.type === "range") {
				const label = `${formatSeconds(spec.start)}-${formatSeconds(spec.end)}`;
				if (streamInfo.duration !== null && spec.end > streamInfo.duration) {
					const error = `Timestamp ${formatSeconds(spec.end)} exceeds video duration (${formatSeconds(Math.floor(streamInfo.duration))})`;
					return {
						url,
						title: `Frames ${label}`,
						content: error,
						error
					};
				}
				const timestamps = frameCount ? computeRangeTimestamps(spec.start, spec.end, frameCount) : computeRangeTimestamps(spec.start, spec.end);
				const result = await extractYouTubeFrames(ytInfo.videoId, timestamps, streamInfo);
				return buildFrameResult(url, label, timestamps.length, result.frames, result.error, result.duration ?? void 0);
			}
			if (frameCount) {
				const end = spec.seconds + (frameCount - 1) * MIN_FRAME_INTERVAL;
				const label = `${formatSeconds(spec.seconds)}-${formatSeconds(end)}`;
				if (streamInfo.duration !== null && end > streamInfo.duration) {
					const error = `Timestamp ${formatSeconds(end)} exceeds video duration (${formatSeconds(Math.floor(streamInfo.duration))})`;
					return {
						url,
						title: `Frames ${label}`,
						content: error,
						error
					};
				}
				const timestamps = computeRangeTimestamps(spec.seconds, end, frameCount);
				const result = await extractYouTubeFrames(ytInfo.videoId, timestamps, streamInfo);
				return buildFrameResult(url, label, timestamps.length, result.frames, result.error, result.duration ?? void 0);
			}
			if (streamInfo.duration !== null && spec.seconds > streamInfo.duration) {
				const error = `Timestamp ${formatSeconds(spec.seconds)} exceeds video duration (${formatSeconds(Math.floor(streamInfo.duration))})`;
				return {
					url,
					title: `Frame at ${options.timestamp}`,
					content: error,
					error
				};
			}
			const frame = await extractYouTubeFrame(ytInfo.videoId, spec.seconds, streamInfo);
			if ("error" in frame) return {
				url,
				title: `Frame at ${options.timestamp}`,
				content: frame.error,
				error: frame.error
			};
			return {
				url,
				title: `Frame at ${options.timestamp}`,
				content: `Video frame at ${options.timestamp}`,
				error: null,
				thumbnail: frame
			};
		}
		const localVideo = await safeVideoInfo(url);
		if (localVideo.error) return {
			url,
			title: "",
			content: "",
			error: localVideo.error
		};
		if (localVideo.info) {
			if (spec.type === "range") {
				const timestamps = frameCount ? computeRangeTimestamps(spec.start, spec.end, frameCount) : computeRangeTimestamps(spec.start, spec.end);
				const result = await extractLocalFrames(localVideo.info.absolutePath, timestamps);
				return buildFrameResult(url, `${formatSeconds(spec.start)}-${formatSeconds(spec.end)}`, timestamps.length, result.frames, result.error);
			}
			if (frameCount) {
				const end = spec.seconds + (frameCount - 1) * MIN_FRAME_INTERVAL;
				const timestamps = computeRangeTimestamps(spec.seconds, end, frameCount);
				const result = await extractLocalFrames(localVideo.info.absolutePath, timestamps);
				return buildFrameResult(url, `${formatSeconds(spec.seconds)}-${formatSeconds(end)}`, timestamps.length, result.frames, result.error);
			}
			const { extractVideoFrame } = await loadVideoExtract();
			const frame = await extractVideoFrame(localVideo.info.absolutePath, spec.seconds);
			if ("error" in frame) return {
				url,
				title: `Frame at ${options.timestamp}`,
				content: frame.error,
				error: frame.error
			};
			return {
				url,
				title: `Frame at ${options.timestamp}`,
				content: `Video frame at ${options.timestamp}`,
				error: null,
				thumbnail: frame
			};
		}
		return {
			url,
			title: "",
			content: "",
			error: "Timestamp extraction only works with YouTube and local video files"
		};
	}
	const localVideo = await safeVideoInfo(url);
	if (localVideo.error) return {
		url,
		title: "",
		content: "",
		error: localVideo.error
	};
	if (localVideo.info) try {
		const { extractVideo } = await loadVideoExtract();
		const result = await extractVideo(localVideo.info, signal, options);
		if (signal?.aborted) return abortedResult(url);
		return result ?? {
			url,
			title: "",
			content: "",
			error: `Video analysis requires Gemini access. Either:\n  1. Sign into gemini.google.com in Chrome (free, uses cookies)\n  2. Set GEMINI_API_KEY in ${WEB_SEARCH_CONFIG_PATH}`
		};
	} catch (err) {
		if (isAbortError(err)) return abortedResult(url);
		return {
			url,
			title: "",
			content: "",
			error: errorMessage(err)
		};
	}
	try {
		const parsed = new URL(url);
		if (parsed.protocol === "http:" || parsed.protocol === "https:") await validateRemoteUrl(parsed, {
			allowRanges: loadSsrfAllowRanges(),
			lookup: options?.lookup
		});
	} catch (err) {
		return {
			url,
			title: "",
			content: "",
			error: errorMessage(err)
		};
	}
	try {
		const { extractGitHub } = await loadGithubExtract();
		const ghResult = await extractGitHub(url, signal, options?.forceClone);
		if (ghResult) return ghResult;
		if (signal?.aborted) return abortedResult(url);
	} catch (err) {
		const message = errorMessage(err);
		if (isAbortError(err)) return abortedResult(url);
		if (isConfigParseError(err)) return {
			url,
			title: "",
			content: "",
			error: message
		};
	}
	const { isYouTubeURL, isYouTubeEnabled, extractYouTube } = await loadYoutubeExtract();
	const ytInfo = isYouTubeURL(url);
	let youtubeEnabled = false;
	try {
		youtubeEnabled = isYouTubeEnabled();
	} catch (err) {
		return {
			url,
			title: "",
			content: "",
			error: errorMessage(err)
		};
	}
	if (ytInfo.isYouTube && youtubeEnabled) {
		try {
			const ytResult = await extractYouTube(url, signal, options?.prompt, options?.model);
			if (ytResult) return ytResult;
			if (signal?.aborted) return abortedResult(url);
		} catch (err) {
			const message = errorMessage(err);
			if (isAbortError(err)) return abortedResult(url);
			return {
				url,
				title: "",
				content: "",
				error: message
			};
		}
		return {
			url,
			title: "",
			content: "",
			error: "Could not extract YouTube video content. Sign into Google in Chrome for automatic access, or set GEMINI_API_KEY."
		};
	}
	if (signal?.aborted) return abortedResult(url);
	const httpResult = await extractViaHttp(url, signal, options);
	if (signal?.aborted) return abortedResult(url);
	if (!httpResult.error) return httpResult;
	if (NON_RECOVERABLE_ERRORS.some((prefix) => httpResult.error.startsWith(prefix))) return httpResult;
	const jinaResult = await extractWithJinaReader(url, signal, options?.lookup);
	if (jinaResult) return jinaResult;
	if (signal?.aborted) return abortedResult(url);
	let parallelError = null;
	try {
		const { isParallelAvailable, extractWithParallel } = await loadParallel();
		if (isParallelAvailable()) {
			const parallelResult = await extractWithParallel(url, signal, options);
			if (parallelResult) return parallelResult;
		}
	} catch (err) {
		if (isAbortError(err)) return abortedResult(url);
		parallelError = errorMessage(err);
		if (isConfigParseError(err)) return {
			...httpResult,
			error: parallelError
		};
	}
	if (signal?.aborted) return abortedResult(url);
	let geminiResult = null;
	try {
		const { extractWithUrlContext, extractWithGeminiWeb } = await loadGeminiUrlContext();
		geminiResult = await extractWithUrlContext(url, signal) ?? await extractWithGeminiWeb(url, signal);
	} catch (err) {
		if (isAbortError(err)) return abortedResult(url);
		if (isConfigParseError(err)) return {
			...httpResult,
			error: errorMessage(err)
		};
	}
	if (geminiResult) return geminiResult;
	if (signal?.aborted) return abortedResult(url);
	const guidance = [
		httpResult.error,
		...parallelError ? [`Parallel fallback failed: ${parallelError}`] : [],
		"",
		"Fallback options:",
		`  \u2022 Set PARALLEL_API_KEY in ${WEB_SEARCH_CONFIG_PATH}`,
		`  \u2022 Set GEMINI_API_KEY in ${WEB_SEARCH_CONFIG_PATH}`,
		"  • Sign into gemini.google.com in Chrome",
		"  • Use web_search to find content about this topic"
	].join("\n");
	return {
		...httpResult,
		error: guidance
	};
}
function isLikelyJSRendered(html) {
	const bodyMatch = html.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
	if (!bodyMatch) return false;
	const textContent = bodyMatch[1].replace(/<script[\s\S]*?<\/script>/gi, "").replace(/<style[\s\S]*?<\/style>/gi, "").replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
	const scriptCount = (html.match(/<script/gi) || []).length;
	return textContent.length < 500 && scriptCount > 3;
}
async function extractViaHttp(url, signal, options) {
	const timeoutMs = options?.timeoutMs ?? DEFAULT_TIMEOUT_MS;
	const activityId = activityMonitor.logStart({
		type: "fetch",
		url
	});
	const controller = new AbortController();
	const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
	const onAbort = () => controller.abort();
	signal?.addEventListener("abort", onAbort);
	try {
		const response = await fetchRemoteUrl(url, {
			signal: controller.signal,
			headers: {
				"User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
				"Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
				"Accept-Language": "en-US,en;q=0.9",
				"Cache-Control": "no-cache",
				"Sec-Fetch-Dest": "document",
				"Sec-Fetch-Mode": "navigate",
				"Sec-Fetch-Site": "none",
				"Sec-Fetch-User": "?1",
				"Upgrade-Insecure-Requests": "1"
			}
		}, {
			allowRanges: loadSsrfAllowRanges(),
			lookup: options?.lookup
		});
		if (!response.ok) {
			activityMonitor.logComplete(activityId, response.status);
			return {
				url,
				title: "",
				content: "",
				error: `HTTP ${response.status}: ${response.statusText}`
			};
		}
		const contentLengthHeader = response.headers.get("content-length");
		const contentType = response.headers.get("content-type") || "";
		const isPDFContent = isPdfUrlOrContentType(url, contentType);
		const maxResponseSize = isPDFContent ? 20 * 1024 * 1024 : 5 * 1024 * 1024;
		if (contentLengthHeader) {
			const contentLength = parseInt(contentLengthHeader, 10);
			if (contentLength > maxResponseSize) {
				activityMonitor.logComplete(activityId, response.status);
				return {
					url,
					title: "",
					content: "",
					error: `Response too large (${Math.round(contentLength / 1024 / 1024)}MB)`
				};
			}
		}
		if (isPDFContent) try {
			const buffer = await response.arrayBuffer();
			const { extractPDFToMarkdown } = await loadPdfExtract();
			const result = await extractPDFToMarkdown(buffer, url);
			activityMonitor.logComplete(activityId, response.status);
			return {
				url,
				title: result.title,
				content: `PDF extracted and saved to: ${result.outputPath}\n\nPages: ${result.pages}\nCharacters: ${result.chars}`,
				error: null
			};
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
			activityMonitor.logError(activityId, message);
			return {
				url,
				title: "",
				content: "",
				error: `PDF extraction failed: ${message}`
			};
		}
		if (contentType.includes("application/octet-stream") || contentType.includes("image/") || contentType.includes("audio/") || contentType.includes("video/") || contentType.includes("application/zip")) {
			activityMonitor.logComplete(activityId, response.status);
			return {
				url,
				title: "",
				content: "",
				error: `Unsupported content type: ${contentType.split(";")[0]}`
			};
		}
		const text = await response.text();
		if (!(contentType.includes("text/html") || contentType.includes("application/xhtml+xml"))) {
			activityMonitor.logComplete(activityId, response.status);
			return {
				url,
				title: extractTextTitle(text, url),
				content: text,
				error: null
			};
		}
		const { parseHTML, Readability, turndown } = await loadHtmlExtractMods();
		const { document } = parseHTML(text);
		const article = new Readability(document).parse();
		if (!article) {
			const { extractRSCContent } = await loadRscExtract();
			const rscResult = extractRSCContent(text);
			if (rscResult) {
				activityMonitor.logComplete(activityId, response.status);
				return {
					url,
					title: rscResult.title,
					content: rscResult.content,
					error: null
				};
			}
			activityMonitor.logComplete(activityId, response.status);
			return {
				url,
				title: "",
				content: "",
				error: isLikelyJSRendered(text) ? "Page appears to be JavaScript-rendered (content loads dynamically)" : "Could not extract readable content from HTML structure"
			};
		}
		const markdown = turndown.turndown(article.content ?? "");
		activityMonitor.logComplete(activityId, response.status);
		if (markdown.length < MIN_USEFUL_CONTENT) return {
			url,
			title: article.title || "",
			content: markdown,
			error: isLikelyJSRendered(text) ? "Page appears to be JavaScript-rendered (content loads dynamically)" : "Extracted content appears incomplete"
		};
		return {
			url,
			title: article.title || "",
			content: markdown,
			error: null
		};
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		if (message.toLowerCase().includes("abort")) activityMonitor.logComplete(activityId, 0);
		else activityMonitor.logError(activityId, message);
		return {
			url,
			title: "",
			content: "",
			error: message
		};
	} finally {
		clearTimeout(timeoutId);
		signal?.removeEventListener("abort", onAbort);
	}
}
function extractHeadingTitle(text) {
	const match = text.match(/^#{1,2}\s+(.+)/m);
	if (!match) return null;
	return match[1].replace(/\*+/g, "").trim() || null;
}
function extractTextTitle(text, url) {
	return extractHeadingTitle(text) ?? (new URL(url).pathname.split("/").pop() || url);
}
async function fetchAllContent(urls, signal, options) {
	return Promise.all(urls.map((url) => fetchLimit(() => extractContent(url, signal, options))));
}
//#endregion
export { extractContent, extractHeadingTitle, fetchAllContent, loadSsrfAllowRanges };

//# sourceMappingURL=extract-BEAF-bqd.mjs.map