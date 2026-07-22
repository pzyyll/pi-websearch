import http from "node:http";
//#region curator-server.ts
let generateCuratorPageMod;
async function loadGenerateCuratorPage() {
	return (await (generateCuratorPageMod ??= import("./curator-page-B0-gxNAo.mjs"))).generateCuratorPage;
}
const STALE_THRESHOLD_MS = 3e4;
const WATCHDOG_INTERVAL_MS = 1e3;
const MAX_BODY_SIZE = 64 * 1024;
function sendJson(res, status, payload) {
	res.writeHead(status, {
		"Content-Type": "application/json",
		"Cache-Control": "no-store"
	});
	res.end(JSON.stringify(payload));
}
function parseJSONBody(req) {
	return new Promise((resolve, reject) => {
		let body = "";
		let size = 0;
		req.on("data", (chunk) => {
			size += chunk.length;
			if (size > MAX_BODY_SIZE) {
				req.destroy();
				reject(/* @__PURE__ */ new Error("Request body too large"));
				return;
			}
			body += chunk.toString();
		});
		req.on("end", () => {
			try {
				resolve(JSON.parse(body));
			} catch (err) {
				const message = err instanceof Error ? err.message : String(err);
				reject(/* @__PURE__ */ new Error(`Invalid JSON: ${message}`));
			}
		});
		req.on("error", reject);
	});
}
async function parseBodyOrSend(req, res) {
	try {
		return await parseJSONBody(req);
	} catch (err) {
		const message = err instanceof Error ? err.message : "Invalid body";
		sendJson(res, message === "Request body too large" ? 413 : 400, {
			ok: false,
			error: message
		});
		return null;
	}
}
function normalizeSelectedIndices(value, options) {
	if (!Array.isArray(value)) return {
		ok: false,
		error: "Invalid selection"
	};
	if (!options.allowEmpty && value.length === 0) return {
		ok: false,
		error: "Invalid selection"
	};
	const normalized = [];
	const seen = /* @__PURE__ */ new Set();
	for (const item of value) {
		if (typeof item !== "number" || !Number.isInteger(item) || item < 0) return {
			ok: false,
			error: "Invalid selection"
		};
		if (item >= options.maxExclusive) return {
			ok: false,
			error: "Invalid selection"
		};
		if (seen.has(item)) continue;
		seen.add(item);
		normalized.push(item);
	}
	if (!options.allowEmpty && normalized.length === 0) return {
		ok: false,
		error: "Invalid selection"
	};
	return {
		ok: true,
		indices: normalized
	};
}
function normalizeSummaryMeta(value) {
	if (!value || typeof value !== "object") return null;
	const meta = value;
	const model = meta.model;
	if (model !== null && typeof model !== "string") return null;
	const durationMs = meta.durationMs;
	if (typeof durationMs !== "number" || !Number.isFinite(durationMs) || durationMs < 0) return null;
	const tokenEstimate = meta.tokenEstimate;
	if (typeof tokenEstimate !== "number" || !Number.isFinite(tokenEstimate) || tokenEstimate < 0) return null;
	const fallbackUsed = meta.fallbackUsed;
	if (typeof fallbackUsed !== "boolean") return null;
	const fallbackReason = meta.fallbackReason;
	if (fallbackReason !== void 0 && typeof fallbackReason !== "string") return null;
	const edited = meta.edited;
	if (edited !== void 0 && typeof edited !== "boolean") return null;
	return {
		model,
		durationMs,
		tokenEstimate,
		fallbackUsed,
		fallbackReason,
		edited
	};
}
function startCuratorServer(options, callbacks) {
	const { queries, sessionToken, timeout, availableProviders, defaultProvider, searchProvider, summaryModels, defaultSummaryModel } = options;
	let browserConnected = false;
	let lastHeartbeatAt = Date.now();
	let stateChangedAt = Date.now();
	let clientIdleMs = null;
	let clientTimeoutSeconds = timeout;
	let completed = false;
	let watchdog = null;
	let state = "SEARCHING";
	let sseResponse = null;
	const sseBuffer = [];
	let nextQueryIndex = queries.length;
	let summarizeAbortController = null;
	let summarizeRequestSeq = 0;
	let sseKeepalive = null;
	const abortInFlightSummarize = () => {
		if (!summarizeAbortController) return;
		summarizeAbortController.abort();
		summarizeAbortController = null;
	};
	const markCompleted = () => {
		if (completed) return false;
		completed = true;
		state = "COMPLETED";
		stateChangedAt = Date.now();
		if (watchdog) {
			clearInterval(watchdog);
			watchdog = null;
		}
		if (sseKeepalive) {
			clearInterval(sseKeepalive);
			sseKeepalive = null;
		}
		abortInFlightSummarize();
		if (sseResponse) {
			try {
				sseResponse.end();
			} catch {}
			sseResponse = null;
		}
		return true;
	};
	const touchHeartbeat = () => {
		lastHeartbeatAt = Date.now();
		browserConnected = true;
	};
	const getEffectiveTimeoutMs = () => Math.max(1e3, Math.floor(clientTimeoutSeconds) * 1e3);
	const shouldTimeoutFromClientIdle = () => state === "RESULT_SELECTION" && clientIdleMs !== null && clientIdleMs >= getEffectiveTimeoutMs();
	function validateToken(body, res) {
		if (!body || typeof body !== "object") {
			sendJson(res, 400, {
				ok: false,
				error: "Invalid body"
			});
			return false;
		}
		if (body.token !== sessionToken) {
			sendJson(res, 403, {
				ok: false,
				error: "Invalid session"
			});
			return false;
		}
		return true;
	}
	function isAvailableProvider(provider) {
		if (provider === "openai") return availableProviders.openai;
		if (provider === "brave") return availableProviders.brave;
		if (provider === "parallel") return availableProviders.parallel;
		if (provider === "tavily") return availableProviders.tavily;
		if (provider === "perplexity") return availableProviders.perplexity;
		if (provider === "exa") return availableProviders.exa;
		if (provider === "gemini") return availableProviders.gemini;
		return false;
	}
	function sendSSE(event, data) {
		const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
		const res = sseResponse;
		if (res && !res.writableEnded && res.socket && !res.socket.destroyed) try {
			res.write(payload);
			return;
		} catch {}
		sseBuffer.push(payload);
	}
	let pageHtmlPromise;
	function getPageHtml() {
		return pageHtmlPromise ??= loadGenerateCuratorPage().then((generateCuratorPage) => generateCuratorPage(queries, sessionToken, timeout, availableProviders, defaultProvider, searchProvider, summaryModels, defaultSummaryModel));
	}
	const server = http.createServer(async (req, res) => {
		try {
			const method = req.method || "GET";
			const url = new URL(req.url || "/", `http://${req.headers.host || "127.0.0.1"}`);
			if (method === "GET" && url.pathname === "/") {
				if (url.searchParams.get("session") !== sessionToken) {
					res.writeHead(403, { "Content-Type": "text/plain" });
					res.end("Invalid session");
					return;
				}
				touchHeartbeat();
				const pageHtml = await getPageHtml();
				res.writeHead(200, {
					"Content-Type": "text/html; charset=utf-8",
					"Cache-Control": "no-store"
				});
				res.end(pageHtml);
				return;
			}
			if (method === "GET" && url.pathname === "/events") {
				if (url.searchParams.get("session") !== sessionToken) {
					res.writeHead(403, { "Content-Type": "text/plain" });
					res.end("Invalid session");
					return;
				}
				if (state === "COMPLETED") {
					sendJson(res, 409, {
						ok: false,
						error: "No events available"
					});
					return;
				}
				if (sseResponse) try {
					sseResponse.end();
				} catch {}
				res.writeHead(200, {
					"Content-Type": "text/event-stream",
					"Cache-Control": "no-cache",
					Connection: "keep-alive",
					"X-Accel-Buffering": "no"
				});
				res.flushHeaders();
				if (res.socket) res.socket.setNoDelay(true);
				sseResponse = res;
				if (sseBuffer.length > 0) {
					const pending = sseBuffer.splice(0, sseBuffer.length);
					for (let i = 0; i < pending.length; i++) {
						const msg = pending[i];
						try {
							res.write(msg);
						} catch {
							sseBuffer.unshift(...pending.slice(i));
							break;
						}
					}
				}
				if (sseKeepalive) clearInterval(sseKeepalive);
				sseKeepalive = setInterval(() => {
					if (sseResponse) try {
						sseResponse.write(":keepalive\n\n");
					} catch {}
				}, 15e3);
				req.on("close", () => {
					if (sseResponse === res) sseResponse = null;
				});
				return;
			}
			if (method === "POST" && url.pathname === "/heartbeat") {
				const body = await parseBodyOrSend(req, res);
				if (!body) return;
				if (!validateToken(body, res)) return;
				touchHeartbeat();
				const heartbeat = body;
				if (typeof heartbeat.timeoutSec === "number" && Number.isFinite(heartbeat.timeoutSec) && heartbeat.timeoutSec > 0) clientTimeoutSeconds = Math.min(600, Math.floor(heartbeat.timeoutSec));
				if (typeof heartbeat.idleMs === "number" && Number.isFinite(heartbeat.idleMs) && heartbeat.idleMs >= 0) clientIdleMs = Math.floor(heartbeat.idleMs);
				const timedOut = shouldTimeoutFromClientIdle();
				sendJson(res, 200, { ok: true });
				if (timedOut && markCompleted()) setImmediate(() => callbacks.onCancel("timeout"));
				return;
			}
			if (method === "POST" && url.pathname === "/provider") {
				const body = await parseBodyOrSend(req, res);
				if (!body) return;
				if (!validateToken(body, res)) return;
				const { provider } = body;
				if (typeof provider !== "string" || provider.length === 0) {
					sendJson(res, 400, {
						ok: false,
						error: "Invalid provider"
					});
					return;
				}
				if (!isAvailableProvider(provider)) {
					sendJson(res, 400, {
						ok: false,
						error: `Provider unavailable: ${provider}`
					});
					return;
				}
				setImmediate(() => callbacks.onProviderChange(provider));
				sendJson(res, 200, { ok: true });
				return;
			}
			if (method === "POST" && url.pathname === "/search") {
				const body = await parseBodyOrSend(req, res);
				if (!body) return;
				if (!validateToken(body, res)) return;
				if (state === "COMPLETED") {
					sendJson(res, 409, {
						ok: false,
						error: "Session closed"
					});
					return;
				}
				const { query, provider } = body;
				if (typeof query !== "string" || query.trim().length === 0) {
					sendJson(res, 400, {
						ok: false,
						error: "Invalid query"
					});
					return;
				}
				if (provider !== void 0) {
					if (typeof provider !== "string" || provider.length === 0) {
						sendJson(res, 400, {
							ok: false,
							error: "Invalid provider"
						});
						return;
					}
					if (!isAvailableProvider(provider)) {
						sendJson(res, 400, {
							ok: false,
							error: `Provider unavailable: ${provider}`
						});
						return;
					}
				}
				const qi = nextQueryIndex++;
				touchHeartbeat();
				try {
					const result = await callbacks.onAddSearch(query.trim(), qi, provider);
					sendJson(res, 200, {
						ok: true,
						queryIndex: qi,
						answer: result.answer,
						results: result.results,
						provider: result.provider
					});
				} catch (err) {
					sendJson(res, 200, {
						ok: true,
						queryIndex: qi,
						error: err instanceof Error ? err.message : "Search failed",
						provider: typeof provider === "string" && provider.length > 0 ? provider : void 0
					});
				}
				return;
			}
			if (method === "POST" && url.pathname === "/summarize") {
				const body = await parseBodyOrSend(req, res);
				if (!body) return;
				if (!validateToken(body, res)) return;
				if (state === "COMPLETED") {
					sendJson(res, 409, {
						ok: false,
						error: "Session closed"
					});
					return;
				}
				const parsed = normalizeSelectedIndices(body.selected, {
					allowEmpty: false,
					maxExclusive: nextQueryIndex
				});
				if (!parsed.ok) {
					sendJson(res, 400, {
						ok: false,
						error: parsed.error
					});
					return;
				}
				let model;
				const bodyModel = body.model;
				if (bodyModel !== void 0) {
					if (typeof bodyModel !== "string") {
						sendJson(res, 400, {
							ok: false,
							error: "Invalid model"
						});
						return;
					}
					const trimmedModel = bodyModel.trim();
					model = trimmedModel.length > 0 ? trimmedModel : void 0;
				}
				const bodyFeedback = body.feedback;
				const feedback = typeof bodyFeedback === "string" && bodyFeedback.trim().length > 0 ? bodyFeedback.trim() : void 0;
				abortInFlightSummarize();
				const controller = new AbortController();
				summarizeAbortController = controller;
				const requestId = ++summarizeRequestSeq;
				try {
					const result = await callbacks.onSummarize(parsed.indices, controller.signal, model, feedback);
					if (requestId !== summarizeRequestSeq || completed) {
						sendJson(res, 409, {
							ok: false,
							error: "Summarize request superseded"
						});
						return;
					}
					sendJson(res, 200, {
						ok: true,
						summary: result.summary,
						meta: result.meta
					});
				} catch (err) {
					const message = err instanceof Error ? err.message : "Summary generation failed";
					sendJson(res, controller.signal.aborted ? 409 : 500, {
						ok: false,
						error: message
					});
				} finally {
					if (summarizeAbortController === controller) summarizeAbortController = null;
				}
				return;
			}
			if (method === "POST" && url.pathname === "/rewrite") {
				const body = await parseBodyOrSend(req, res);
				if (!body) return;
				if (!validateToken(body, res)) return;
				if (state === "COMPLETED") {
					sendJson(res, 409, {
						ok: false,
						error: "Session closed"
					});
					return;
				}
				const { query } = body;
				if (typeof query !== "string" || query.trim().length === 0) {
					sendJson(res, 400, {
						ok: false,
						error: "Invalid query"
					});
					return;
				}
				const controller = new AbortController();
				req.on("close", () => controller.abort());
				touchHeartbeat();
				try {
					sendJson(res, 200, {
						ok: true,
						query: await callbacks.onRewriteQuery(query.trim(), controller.signal)
					});
				} catch (err) {
					const message = err instanceof Error ? err.message : "Rewrite failed";
					sendJson(res, controller.signal.aborted ? 409 : 500, {
						ok: false,
						error: message
					});
				}
				return;
			}
			if (method === "POST" && url.pathname === "/submit") {
				const body = await parseBodyOrSend(req, res);
				if (!body) return;
				if (!validateToken(body, res)) return;
				const parsed = normalizeSelectedIndices(body.selected, {
					allowEmpty: true,
					maxExclusive: nextQueryIndex
				});
				if (!parsed.ok) {
					sendJson(res, 400, {
						ok: false,
						error: parsed.error
					});
					return;
				}
				let summary;
				const bodySummary = body.summary;
				if (bodySummary !== void 0) {
					if (typeof bodySummary !== "string") {
						sendJson(res, 400, {
							ok: false,
							error: "Invalid summary"
						});
						return;
					}
					const trimmedSummary = bodySummary.trim();
					summary = trimmedSummary.length > 0 ? trimmedSummary : void 0;
				}
				let summaryMeta;
				const bodySummaryMeta = body.summaryMeta;
				if (bodySummaryMeta !== void 0) {
					const parsedSummaryMeta = normalizeSummaryMeta(bodySummaryMeta);
					if (!parsedSummaryMeta) {
						sendJson(res, 400, {
							ok: false,
							error: "Invalid summaryMeta"
						});
						return;
					}
					summaryMeta = parsedSummaryMeta;
				}
				if (state !== "SEARCHING" && state !== "RESULT_SELECTION") {
					sendJson(res, 409, {
						ok: false,
						error: "Cannot submit in current state"
					});
					return;
				}
				if (!markCompleted()) {
					sendJson(res, 409, {
						ok: false,
						error: "Session closed"
					});
					return;
				}
				const rawResults = body.rawResults === true;
				sendJson(res, 200, { ok: true });
				setImmediate(() => callbacks.onSubmit({
					selectedQueryIndices: parsed.indices,
					summary,
					summaryMeta,
					rawResults
				}));
				return;
			}
			if (method === "POST" && url.pathname === "/cancel") {
				const body = await parseBodyOrSend(req, res);
				if (!body) return;
				if (!validateToken(body, res)) return;
				if (!markCompleted()) {
					sendJson(res, 200, { ok: true });
					return;
				}
				const { reason } = body;
				sendJson(res, 200, { ok: true });
				const cancelReason = reason === "timeout" ? "timeout" : "user";
				setImmediate(() => callbacks.onCancel(cancelReason));
				return;
			}
			res.writeHead(404, { "Content-Type": "text/plain" });
			res.end("Not found");
		} catch (err) {
			sendJson(res, 500, {
				ok: false,
				error: err instanceof Error ? err.message : "Server error"
			});
		}
	});
	return new Promise((resolve, reject) => {
		const onError = (err) => {
			reject(/* @__PURE__ */ new Error(`Curator server failed to start: ${err.message}`));
		};
		server.once("error", onError);
		server.listen(0, "127.0.0.1", () => {
			server.off("error", onError);
			const addr = server.address();
			if (!addr || typeof addr === "string") {
				reject(/* @__PURE__ */ new Error("Curator server: invalid address"));
				return;
			}
			const url = `http://localhost:${addr.port}/?session=${sessionToken}`;
			watchdog = setInterval(() => {
				if (completed) return;
				if (!browserConnected) {
					const noBrowserTimeoutMs = Math.max(5e3, getEffectiveTimeoutMs());
					if (state !== "RESULT_SELECTION") return;
					if (Date.now() - stateChangedAt <= noBrowserTimeoutMs) return;
					if (!markCompleted()) return;
					setImmediate(() => callbacks.onCancel("timeout"));
					return;
				}
				if (shouldTimeoutFromClientIdle()) {
					if (!markCompleted()) return;
					setImmediate(() => callbacks.onCancel("timeout"));
					return;
				}
				if (Date.now() - lastHeartbeatAt <= STALE_THRESHOLD_MS) return;
				const staleReason = state === "RESULT_SELECTION" ? "timeout" : "stale";
				if (!markCompleted()) return;
				setImmediate(() => callbacks.onCancel(staleReason));
			}, WATCHDOG_INTERVAL_MS);
			resolve({
				server,
				url,
				close: () => {
					const wasOpen = markCompleted();
					try {
						server.close();
					} catch {}
					if (wasOpen) setImmediate(() => callbacks.onCancel("stale"));
				},
				pushResult: (queryIndex, data) => {
					if (completed) return;
					sendSSE("result", {
						queryIndex,
						query: queries[queryIndex] ?? "",
						...data
					});
				},
				pushError: (queryIndex, error, provider) => {
					if (completed) return;
					sendSSE("search-error", {
						queryIndex,
						query: queries[queryIndex] ?? "",
						error,
						provider
					});
				},
				searchesDone: () => {
					if (completed) return;
					sendSSE("done", {});
					state = "RESULT_SELECTION";
					stateChangedAt = Date.now();
				},
				getConnectionState: () => ({
					browserConnected,
					lastHeartbeatAgeMs: Date.now() - lastHeartbeatAt
				})
			});
		});
	});
}
//#endregion
export { startCuratorServer };

//# sourceMappingURL=curator-server-eVysK59J.mjs.map