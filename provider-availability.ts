// ABOUTME: Provider availability probes loaded only when search/curator needs them.
// ABOUTME: Dynamically imports provider modules so the extension entry stays light.

import type { ExtensionContext } from "@earendil-works/pi-coding-agent";

export interface ProviderAvailability {
	openai: boolean;
	brave: boolean;
	parallel: boolean;
	tavily: boolean;
	perplexity: boolean;
	exa: boolean;
	gemini: boolean;
}

/**
 * Probe which search providers are currently usable.
 * Loads provider modules on first call (Promise.all); acceptable for first search/curator path.
 */
export async function getProviderAvailability(ctx: ExtensionContext): Promise<ProviderAvailability> {
	const [
		openaiMod,
		braveMod,
		parallelMod,
		tavilyMod,
		perplexityMod,
		exaMod,
		geminiApiMod,
		geminiWebMod,
	] = await Promise.all([
		import("./openai-search.ts"),
		import("./brave.ts"),
		import("./parallel.ts"),
		import("./tavily.ts"),
		import("./perplexity.ts"),
		import("./exa.ts"),
		import("./gemini-api.ts"),
		import("./gemini-web.ts"),
	]);

	const geminiWebAvail = await geminiWebMod.isGeminiWebAvailable();
	return {
		openai: await openaiMod.isOpenAISearchAvailable(ctx),
		brave: braveMod.isBraveAvailable(),
		parallel: parallelMod.isParallelAvailable(),
		tavily: tavilyMod.isTavilyAvailable(),
		perplexity: perplexityMod.isPerplexityAvailable(),
		exa: exaMod.isExaAvailable(),
		gemini: geminiApiMod.isGeminiApiAvailable() || !!geminiWebAvail,
	};
}
