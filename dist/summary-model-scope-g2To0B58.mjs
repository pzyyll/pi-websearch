import { homedir } from "node:os";
import { join } from "node:path";
import { existsSync, readFileSync } from "node:fs";
//#region summary-model-scope.ts
const THINKING_LEVELS = /* @__PURE__ */ new Set([
	"off",
	"minimal",
	"low",
	"medium",
	"high",
	"xhigh"
]);
function getAgentDir() {
	return process.env.PI_CODING_AGENT_DIR || join(homedir(), ".pi", "agent");
}
function readSettings(path) {
	if (!existsSync(path)) return {};
	const raw = readFileSync(path, "utf8");
	try {
		return JSON.parse(raw);
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		throw new Error(`Failed to parse ${path}: ${message}`);
	}
}
function loadEnabledModelPatterns(ctx) {
	const globalSettings = readSettings(join(getAgentDir(), "settings.json"));
	const projectSettings = ctx.isProjectTrusted() ? readSettings(join(ctx.cwd, ".pi", "settings.json")) : {};
	const value = Object.hasOwn(projectSettings, "enabledModels") ? projectSettings.enabledModels : globalSettings.enabledModels;
	if (value === void 0) return null;
	if (!Array.isArray(value)) throw new Error("enabledModels must be an array");
	return value.filter((item) => typeof item === "string").map((item) => item.trim()).filter(Boolean);
}
function summaryModelValue(model) {
	return `${model.provider}/${model.id}`;
}
function stripThinkingSuffix(pattern) {
	const index = pattern.lastIndexOf(":");
	if (index < 0) return pattern;
	const suffix = pattern.slice(index + 1);
	return THINKING_LEVELS.has(suffix) ? pattern.slice(0, index) : pattern;
}
function globToRegExp(pattern) {
	let source = "^";
	for (const char of pattern) if (char === "*") source += ".*";
	else if (char === "?") source += ".";
	else source += char.replace(/[|\\{}()[\]^$+?.]/g, "\\$&");
	return new RegExp(`${source}$`, "i");
}
function modelMatchesEnabledPatterns(model, patterns) {
	if (patterns === null) return true;
	const value = summaryModelValue(model).toLowerCase();
	const id = model.id.toLowerCase();
	for (const rawPattern of patterns) {
		const pattern = stripThinkingSuffix(rawPattern.trim()).toLowerCase();
		if (!pattern) continue;
		if (pattern.includes("*") || pattern.includes("?")) {
			const regex = globToRegExp(pattern);
			if (regex.test(value) || regex.test(id)) return true;
			continue;
		}
		if (pattern === value || pattern === id) return true;
	}
	return false;
}
//#endregion
export { modelMatchesEnabledPatterns as n, loadEnabledModelPatterns as t };

//# sourceMappingURL=summary-model-scope-g2To0B58.mjs.map