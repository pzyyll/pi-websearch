// ABOUTME: Cached dynamic importers for heavy pi-web-access feature modules.
// ABOUTME: Keeps extension entry free of eager provider/extract/curator dependency graphs.

let extractMod: Promise<typeof import("./extract.ts")> | undefined;
let githubExtractMod: Promise<typeof import("./github-extract.ts")> | undefined;
let curatorServerMod: Promise<typeof import("./curator-server.ts")> | undefined;
let summaryReviewMod: Promise<typeof import("./summary-review.ts")> | undefined;
let geminiSearchMod: Promise<typeof import("./gemini-search.ts")> | undefined;
let geminiWebMod: Promise<typeof import("./gemini-web.ts")> | undefined;
let providerAvailabilityMod: Promise<typeof import("./provider-availability.ts")> | undefined;

export function loadExtract() {
  return (extractMod ??= import("./extract.ts"));
}

export function loadGithubExtract() {
  return (githubExtractMod ??= import("./github-extract.ts"));
}

export function loadCuratorServer() {
  return (curatorServerMod ??= import("./curator-server.ts"));
}

export function loadSummaryReview() {
  return (summaryReviewMod ??= import("./summary-review.ts"));
}

export function loadGeminiSearch() {
  return (geminiSearchMod ??= import("./gemini-search.ts"));
}

export function loadGeminiWeb() {
  return (geminiWebMod ??= import("./gemini-web.ts"));
}

export function loadProviderAvailability() {
  return (providerAvailabilityMod ??= import("./provider-availability.ts"));
}
