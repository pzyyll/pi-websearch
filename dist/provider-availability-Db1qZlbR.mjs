//#region provider-availability.ts
/**
* Probe which search providers are currently usable.
* Loads provider modules on first call (Promise.all); acceptable for first search/curator path.
*/
async function getProviderAvailability(ctx) {
	const [openaiMod, braveMod, parallelMod, tavilyMod, perplexityMod, exaMod, geminiApiMod, geminiWebMod] = await Promise.all([
		import("./openai-search-BBUbTQfw.mjs"),
		import("./brave-DiQbd-LM.mjs"),
		import("./parallel-VlcMu7qG.mjs"),
		import("./tavily-CDwH3mbP.mjs"),
		import("./perplexity-BVwSQCyi.mjs"),
		import("./exa-Ca_bEPhU.mjs"),
		import("./gemini-api-3ZthksRh.mjs"),
		import("./gemini-web-BcCxdxzO.mjs")
	]);
	const geminiWebAvail = await geminiWebMod.isGeminiWebAvailable();
	return {
		openai: await openaiMod.isOpenAISearchAvailable(ctx),
		brave: braveMod.isBraveAvailable(),
		parallel: parallelMod.isParallelAvailable(),
		tavily: tavilyMod.isTavilyAvailable(),
		perplexity: perplexityMod.isPerplexityAvailable(),
		exa: exaMod.isExaAvailable(),
		gemini: geminiApiMod.isGeminiApiAvailable() || !!geminiWebAvail
	};
}
//#endregion
export { getProviderAvailability };

//# sourceMappingURL=provider-availability-Db1qZlbR.mjs.map