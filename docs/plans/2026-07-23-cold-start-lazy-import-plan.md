# Cold-Start Lazy Import Implementation Plan

**Goal:** Cut `pi-web-access` extension module-import cold-start cost by deferring heavy local modules and npm deps until first use, without changing tool/command UX.

**Inputs:** Startup timings analysis (`pi-web-access` ~4.6s module import / ~27% of extension total); current eager graph from `index.ts` → 30 local `.ts` files (~460KB) including `curator-page.ts` (~110KB) and `extract.ts` → `linkedom` / readability / turndown / unpdf; user request to lazy-import wherever safe.

**Assumptions:**

- Pi continues loading extensions via jiti from `package.json` `pi.extensions` (today `./index.ts`); this plan does **not** require a compiled `dist/` entry, but keeps that as a follow-on.
- Host-provided packages (`typebox`, `@earendil-works/pi-tui`, `@earendil-works/pi-ai/compat`) stay static in the entry: tool registration needs `Type` / `StringEnum` and renderers need `Box` / `Text` at load time; jiti aliases already map them to the host copies.
- First tool/command invocation may pay a one-time dynamic-import cost; that is acceptable vs paying it on every `pi` boot.
- Availability checks (`isXAvailable`) may run on first search/curator path, not at extension factory time (current factory already avoids calling them; only static imports force the graph).

**Architecture:** Keep a thin eager shell in `index.ts` (config, tool/command registration, storage, activity, light helpers). Move search providers, fetch/extract pipeline, curator UI, summary generation, and Gemini Web/cookie code behind `await import(...)` (or cached dynamic loaders). Split shared types into a zero-runtime module so type-only edges do not pull implementations. Prefer call-site loaders with module-level promise caches over scattering bare `import()` everywhere.

**Tech Stack:** Existing ESM TypeScript sources, Node `import()`, `node --test` suite under `test/`, optional small Node timing script for import-graph measurement. No new runtime deps.

---

## Success Metrics

| Metric | Baseline (from cold analysis / remeasure) | Target after this plan |
|--------|---------------------------------------------|------------------------|
| Eager local TS files pulled by entry | 30 files / ~460KB | ≤ 12 light modules (utils, storage, activity, fetch-params, render-search-error, summary-model-scope, search-types, provider-availability, thin facades) |
| Eager npm feature deps from entry graph | `linkedom`, `@mozilla/readability`, `turndown`, `unpdf` | None at entry; loaded only on first `fetch_content` / extract path |
| `curator-page.ts` at entry | Yes (via `curator-server`) | No; load on first curator open |
| Extension module-import time (isolated jiti, warm OS cache) | ~0.6–4.6s depending on cache/AV | ≥ 50% reduction vs same-machine baseline script |
| Behavior | tools/commands/workflows unchanged | Existing `node --test` green; manual smoke of search + fetch + curator |

Out of scope for this plan:

- Changing pi-coding-agent jiti/`moduleCache` behavior
- Optimizing other extensions (e.g. `pi-mcp-adapter`)
- Shipping a prebuilt `dist/index.js` (follow-on; noted under Rollout)
- Refactoring tool UX, provider ranking, or config schema

---

## File Map

- Create: `search-types.ts` — shared `SearchProvider` / `ResolvedSearchProvider` / `SearchResult`-facing types with no runtime deps
- Create: `provider-availability.ts` — env/config-only (or dynamically loaded) availability probes; no search HTTP clients
- Create: `load-modules.ts` — cached dynamic importers for heavy modules (`extract`, `gemini-search`, providers, curator, summary-review, github-extract, gemini-web)
- Create: `scripts/measure-import-graph.mjs` — prints eager vs dynamic import graph size / optional jiti timing
- Create: `test/lazy-import-boundaries.test.mjs` — static guards that entry does not hard-import heavy modules/deps
- Modify: `index.ts` — drop static heavy imports; use loaders at execute/command paths; keep registration + light helpers eager
- Modify: `gemini-search.ts` — per-provider dynamic import; stop static fan-out to all providers
- Modify: `extract.ts` — dynamic import of linkedom/readability/turndown, pdf/youtube/video/github/gemini-url-context/parallel extract paths
- Modify: `curator-server.ts` — dynamic import `curator-page.ts` when generating HTML
- Modify: `summary-review.ts` — keep `complete` usage but ensure entry only loads this module on summary paths (via loader)
- Modify: provider modules only if availability must be split from heavy search code (`openai-search.ts` already dynamic-imports pi-ai; prefer loaders over file splits unless needed)
- Modify: `package.json` — add `scripts.measure:import` (optional `test` unchanged)
- Test: existing `test/*.mjs` remain source of truth for behavior; extend where lazy changes risk regressions

Every new/edited `.ts` file must keep the repo rule: start with a 2-line `ABOUTME:` header.

---

## Tasks

### Task 1: Baseline measurement harness

**Outcome:** Repeatable script records entry eager graph and import timing before/after changes.

**Files:**

- Create: `scripts/measure-import-graph.mjs`
- Modify: `package.json` — add `"measure:import": "node scripts/measure-import-graph.mjs"`

**Steps:**

- [ ] Walk static `from "./..."` edges from `index.ts` (ignore `import type` and dynamic `import()`).
- [ ] Report: file count, total bytes, list of modules that import `linkedom` / `@mozilla/readability` / `turndown` / `unpdf` / `curator-page`.
- [ ] Optional flag `--jiti`: if `jiti` resolvable from a local pi install or `node_modules`, time `jiti.import(index.ts)` once; otherwise skip with a clear message.
- [ ] Print a single JSON summary line for easy before/after paste into PR notes.

**Validation:**

- Run: `npm run measure:import`
- Expected: lists ~30 eager local files including `extract.ts`, `gemini-search.ts`, `curator-page.ts` (or `curator-server.ts` → page); mentions heavy npm markers.

---

### Task 2: Extract zero-runtime types + cached loaders

**Outcome:** Entry can type-check search/provider APIs without loading implementations; one place owns dynamic import caches.

**Files:**

- Create: `search-types.ts`
- Create: `load-modules.ts`
- Modify: `index.ts` — replace `import type { SearchResult } from "./perplexity.ts"` and provider type imports from `gemini-search.ts` with `search-types.ts`
- Modify: `gemini-search.ts` — re-export types from `search-types.ts` (compat for tests/importers) or import types from there

**Steps:**

- [ ] Move `SearchProvider`, `ResolvedSearchProvider`, and any result types needed by `index.ts` into `search-types.ts` (no value imports).
- [ ] In `load-modules.ts`, export cached loaders, e.g.:

  ```ts
  // ABOUTME: Cached dynamic importers for heavy pi-web-access feature modules.
  // ABOUTME: Keeps extension entry free of eager provider/extract/curator dependency graphs.

  let extractMod: Promise<typeof import("./extract.ts")> | undefined;
  export function loadExtract() {
    return (extractMod ??= import("./extract.ts"));
  }
  // same pattern: loadGeminiSearch, loadCuratorServer, loadSummaryReview,
  // loadGithubExtract, loadGeminiWeb, loadProviderAvailability
  ```

- [ ] Do **not** call loaders at module top level or inside the extension factory body except where registration truly needs them (it should not).

**Validation:**

- Run: `node --test test/tool-registration-config.test.mjs`
- Expected: pass (still matches registration gate strings).
- Run: `npm run measure:import`
- Expected: unchanged or only +2 light files until later tasks rewire imports.

---

### Task 3: Decouple entry from extract / curator / summary / github

**Outcome:** Opening the extension no longer parses or evaluates fetch pipeline, curator HTML, summary LLM helper, or github clone helpers.

**Files:**

- Modify: `index.ts`
- Modify: `curator-server.ts`
- Create: `test/lazy-import-boundaries.test.mjs`

**Steps:**

- [ ] Remove static imports from `index.ts`:

  - `./extract.ts` (`fetchAllContent`, `ExtractedContent`)
  - `./github-extract.ts` (`clearCloneCache`)
  - `./curator-server.ts` (`startCuratorServer`, `CuratorServerHandle`)
  - `./summary-review.ts` (`buildDeterministicSummary`, `generateSummaryDraft`, types)
  - `./gemini-search.ts` value import `search` (keep types via `search-types.ts`)

- [ ] Replace call sites:

  | Call site | Loader usage |
  |-----------|--------------|
  | `startBackgroundFetch` / `fetch_content` execute | `const { fetchAllContent } = await loadExtract()` |
  | `handleSessionChange` / `session_shutdown` `clearCloneCache` | `const { clearCloneCache } = await loadGithubExtract(); clearCloneCache()` — or fire-and-forget void loader then clear; must not block session events unreasonably |
  | curator start paths | `const { startCuratorServer } = await loadCuratorServer()` |
  | summary draft / deterministic summary | `const mod = await loadSummaryReview()` |
  | `search(...)` in tools/commands | `const { search } = await loadGeminiSearch()` |

- [ ] For `ExtractedContent` / `CuratorServerHandle` / `SummaryMeta` types: use `import type` from their modules (type-only, erased) **or** duplicate minimal structural types in `search-types.ts` / local interfaces if jiti/type stripping is unreliable in tests. Prefer `import type`.

- [ ] In `curator-server.ts`, replace static `import { generateCuratorPage } from "./curator-page.ts"` with:

  ```ts
  async function loadGenerateCuratorPage() {
    const mod = await import("./curator-page.ts");
    return mod.generateCuratorPage;
  }
  ```

  Call only when building HTML responses (not at server listen).

- [ ] Add `test/lazy-import-boundaries.test.mjs` that reads `index.ts` source and asserts it does **not** contain static import strings for:

  - `./extract.ts`
  - `./github-extract.ts`
  - `./curator-server.ts`
  - `./curator-page.ts`
  - `./summary-review.ts`
  - `./gemini-web.ts`
  - `./chrome-cookies.ts`
  - provider implementation paths used only for search (`./brave.ts`, `./exa.ts`, `./tavily.ts`, `./parallel.ts`, `./perplexity.ts`, `./openai-search.ts`, `./gemini-api.ts`)

  Allow `import type` lines if present; forbid value imports.

**Validation:**

- Run: `node --test test/lazy-import-boundaries.test.mjs test/tool-registration-config.test.mjs test/fetch-params.test.mjs`
- Expected: all pass.
- Run: `npm run measure:import`
- Expected: eager graph no longer includes `curator-page.ts`, `extract.ts`, `github-extract.ts`, `summary-review.ts` (unless still reachable via a remaining static edge — fix until clean).

---

### Task 4: Lazy provider fan-out in `gemini-search.ts` + entry availability

**Outcome:** First load of search facade does not pull every provider module; entry availability checks also stay off the eager path.

**Files:**

- Create: `provider-availability.ts`
- Modify: `gemini-search.ts`
- Modify: `index.ts`
- Modify: `test/search-providers.test.mjs` only if it imports private paths that break
- Modify: `test/lazy-import-boundaries.test.mjs` — assert `gemini-search.ts` has no static provider value imports

**Steps:**

- [ ] Implement `provider-availability.ts` with the same external behavior as current `isXAvailable` / `isGeminiApiAvailable` / `isGeminiWebAvailable` / `isOpenAISearchAvailable` used by `getProviderAvailability` in `index.ts`.

  Preferred approach (minimal file churn):

  1. Dynamic-import the existing provider module inside each probe:

     ```ts
     export async function getProviderAvailability(ctx: ExtensionContext): Promise<ProviderAvailability> {
       const [
         { isOpenAISearchAvailable },
         { isBraveAvailable },
         // ...
         geminiWeb,
       ] = await Promise.all([
         import("./openai-search.ts"),
         import("./brave.ts"),
         // ...
         import("./gemini-web.ts"),
       ]);
       const geminiWebAvail = await geminiWeb.isGeminiWebAvailable();
       return { openai: await isOpenAISearchAvailable(ctx), brave: isBraveAvailable(), /* ... */ };
     }
     ```

  2. Move `getProviderAvailability` / `resolveProvider` helpers from `index.ts` here **or** keep helpers in `index.ts` but call this module via `loadProviderAvailability()`.

  Note: This still loads **all** providers on first availability check (search/curator). That is fine for cold **boot**; optional stretch is sequential short-circuit for configured provider only (not required for v1).

- [ ] Remove from `index.ts` static imports:

  - `isPerplexityAvailable`, `isExaAvailable`, `isGeminiApiAvailable`, `getActiveGoogleEmail`, `isGeminiWebAvailable`, `isBrowserCookieAccessAllowed`, `isBraveAvailable`, `isOpenAISearchAvailable`, `isParallelAvailable`, `isTavilyAvailable`

- [ ] `google-account` command: `const { isGeminiWebAvailable, getActiveGoogleEmail } = await loadGeminiWeb()` (or from availability module).

- [ ] Rewrite `gemini-search.ts` top-level value imports of providers to dynamic imports inside branches:

  - `provider === "brave"` → `const { searchWithBrave } = await import("./brave.ts")`
  - same for openai, parallel, tavily, perplexity, exa
  - gemini path → dynamic `gemini-api` / `gemini-web`
  - auto-fallback chain: dynamic import only when that fallback step runs (do not `Promise.all` every provider at start of auto)

- [ ] Keep `activityMonitor` and `utils` static inside `gemini-search.ts` (light).
- [ ] Preserve abort-error and fallback error message behavior byte-for-byte where practical; update tests only if wording must change.

**Validation:**

- Run: `node --test test/search-providers.test.mjs test/lazy-import-boundaries.test.mjs test/gemini-web-cookie-opt-in.test.mjs`
- Expected: pass.
- Run: `npm run measure:import`
- Expected: eager entry graph excludes all provider implementation files and `gemini-web.ts` / `chrome-cookies.ts`.

---

### Task 5: Lazy heavy work inside `extract.ts`

**Outcome:** Loading extract for `fetch_content` still defers the worst npm deps until the specific URL type needs them.

**Files:**

- Modify: `extract.ts`
- Modify: `pdf-extract.ts` only if needed (keep `unpdf` inside pdf module; extract dynamic-imports pdf module)
- Test: `test/pdf-extract.test.mjs`, `test/ssrf-protection.test.mjs`, `test/youtube-extract-errors.test.mjs`, `test/parallel.test.mjs`

**Steps:**

- [ ] Remove static:

  ```ts
  import { Readability } from "@mozilla/readability";
  import { parseHTML } from "linkedom";
  import TurndownService from "turndown";
  ```

  Load inside the HTML→markdown path only:

  ```ts
  const [{ Readability }, { parseHTML }, TurndownMod] = await Promise.all([
    import("@mozilla/readability"),
    import("linkedom"),
    import("turndown"),
  ]);
  const TurndownService = TurndownMod.default ?? TurndownMod;
  ```

- [ ] Dynamic-import feature modules at branch points:

  | Branch | Dynamic module |
  |--------|----------------|
  | PDF | `./pdf-extract.ts` |
  | GitHub | `./github-extract.ts` |
  | YouTube | `./youtube-extract.ts` |
  | local video | `./video-extract.ts` |
  | Gemini URL context / Gemini Web extract | `./gemini-url-context.ts` |
  | Parallel extract | `./parallel.ts` |
  | RSC | `./rsc-extract.ts` (optional; smaller) |

- [ ] Keep `ssrf-protection.ts`, `activity.ts`, `utils.ts`, `p-limit` static if used on every fetch (small). If `p-limit` is only for concurrency in `fetchAllContent`, static is fine.
- [ ] Cache dynamic module promises at module scope to avoid re-import per URL in a multi-URL fetch.

**Validation:**

- Run: `node --test test/pdf-extract.test.mjs test/ssrf-protection.test.mjs test/ssrf-allow-ranges-config.test.mjs test/youtube-extract-errors.test.mjs test/parallel.test.mjs test/fetch-params.test.mjs`
- Expected: pass.
- Manual/optional: import only `extract.ts` under jiti and confirm `linkedom` not in `process.moduleLoadList` / not evaluated until HTML path (if easy to assert; otherwise rely on code review + boundaries test for entry).

---

### Task 6: Guardrails + full regression + measure delta

**Outcome:** Suite green; measured eager graph meets targets; documented before/after numbers.

**Files:**

- Modify: `test/lazy-import-boundaries.test.mjs` — final assertions
- Modify: `CHANGELOG.md` — note cold-start lazy loading (English, concise)
- Modify: `README.md` only if developer docs should mention deferred loading (optional one line under architecture/dev)

**Steps:**

- [ ] Expand boundary tests:

  1. `index.ts` static value-import denylist (Task 3–4 list).
  2. `gemini-search.ts` does not statically import provider implementation files.
  3. `curator-server.ts` does not statically import `curator-page.ts`.
  4. `extract.ts` source does not contain static `from "linkedom"` / `from "@mozilla/readability"` / `from "turndown"` / `from "unpdf"` (unpdf should remain only in `pdf-extract.ts`).

- [ ] Run full test suite.
- [ ] Run `npm run measure:import` and record JSON summary in the PR/commit message (not necessarily in repo).
- [ ] Smoke checklist (manual, with pi if available):

  1. Start pi with extension enabled — Startup Timings `pi-web-access` module import down vs personal baseline.
  2. `web_search` with `workflow: "none"` — returns results.
  3. `fetch_content` on a normal URL — markdown extraction works (pays linkedom cost here).
  4. Curator workflow once — page loads (pays `curator-page` cost here).
  5. `/google-account` if cookies configured — still works.

**Validation:**

- Run: `npm test`
- Expected: all tests pass.
- Run: `npm run measure:import`
- Expected: eager local file count ≤ 12 (or documented near-miss with justification); no `curator-page.ts`, no `linkedom` in eager graph markers.

---

## Final Validation

- Run: `npm test && npm run measure:import`
- Expected:
  - All existing + new tests pass.
  - Eager import graph from `index.ts` excludes provider implementations, `extract.ts` HTML stack, `curator-page.ts`, `summary-review.ts`, `gemini-web.ts`, `chrome-cookies.ts`.
  - Same-machine jiti/module-import timing for the extension entry improves by ≥ 50% vs Task 1 baseline (warm OS cache comparison is acceptable if both runs use the same method).

---

## Failure Behavior

- Dynamic `import()` failure (missing dep, syntax error in lazy module): surface as tool/command error string to the user; do not crash the whole pi session at boot.
- Partial multi-provider auto-fallback: if one provider module fails to load, treat like provider runtime failure and continue fallback chain (same as network failure messaging where possible).
- Session shutdown while dynamic import in flight: keep existing abort/`sessionActive` guards; `clearCloneCache` should tolerate import failure (log/ignore).

---

## Privacy and Security

- No change to SSRF allow-list behavior; `ssrf-protection.ts` remains authoritative on fetch.
- Gemini Web / browser cookie access stays opt-in via existing `gemini-web-config` / cookie paths; lazy loading must not auto-run cookie reads at import time (today it does not; keep it that way).
- Dynamic import paths must be static string literals (no user-controlled module specifiers).

---

## Rollout Notes

- Pure source change; no config migration.
- Users on older pi with jiti continue to load `./index.ts`.
- **Follow-on (separate plan):** add `tsdown`/`tsup` build to `dist/index.js` and point `pi.extensions` at dist for further jiti elimination. Lazy import still helps first-use memory and secondary loads even with dist.
- Ship behind normal package version bump; mention cold-start improvement in `CHANGELOG.md`.

---

## Risks and Mitigations

| Risk | Mitigation |
|------|------------|
| First search/fetch slower | Cache module promises; only first call pays; boot is the product metric |
| `import type` still pulls modules under jiti | Boundary tests + prefer types in `search-types.ts`; verify measure script ignores type-only edges |
| Circular import via loaders | Keep `load-modules.ts` free of imports from `index.ts`; only import leaf feature modules |
| Tests that `readFileSync` index source for patterns break | Update string-based tests carefully; keep registration gate tests intact |
| Auto provider path loads many modules on first search | Accept for v1; optional later: config-driven single-provider short-circuit |
| Windows AV still slow on first dynamic import | Deferred to first use; boot path no longer touches those files |

---

## Open Questions

- None blocking. Optional product choice (not required for v1): should first `getProviderAvailability` load only the configured provider when `provider !== "auto"`? Default assumption: **no** for v1 (keep availability matrix complete for curator UI); can be a fast follow.

---

## Suggested implementation order

```
Task 1 (measure) → Task 2 (types/loaders) → Task 3 (entry decoupling)
  → Task 4 (providers) → Task 5 (extract internals) → Task 6 (guards + full validation)
```

Each task should leave `npm test` green before moving on.
