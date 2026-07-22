//#region rsc-extract.ts
function extractRSCContent(html) {
	if (!html.includes("self.__next_f.push")) return null;
	const chunkMap = /* @__PURE__ */ new Map();
	for (const match of html.matchAll(/<script>self\.__next_f\.push\(\[1,"([\s\S]*?)"\]\)<\/script>/g)) {
		let content;
		try {
			content = JSON.parse("\"" + match[1] + "\"");
		} catch {
			continue;
		}
		for (const line of content.split("\n")) {
			if (!line.trim()) continue;
			const colonIdx = line.indexOf(":");
			if (colonIdx <= 0 || colonIdx > 4) continue;
			const id = line.slice(0, colonIdx);
			if (!/^[0-9a-f]+$/i.test(id)) continue;
			const payload = line.slice(colonIdx + 1);
			if (!payload) continue;
			const existing = chunkMap.get(id);
			if (!existing || payload.length > existing.length) chunkMap.set(id, payload);
		}
	}
	if (chunkMap.size === 0) return null;
	const title = html.match(/<title[^>]*>([^<]+)<\/title>/)?.[1]?.split("|")[0]?.trim() || "";
	const parsedCache = /* @__PURE__ */ new Map();
	function getParsedChunk(id) {
		if (parsedCache.has(id)) return parsedCache.get(id);
		const chunk = chunkMap.get(id);
		if (!chunk || !chunk.startsWith("[")) {
			parsedCache.set(id, null);
			return null;
		}
		try {
			const parsed = JSON.parse(chunk);
			parsedCache.set(id, parsed);
			return parsed;
		} catch {
			parsedCache.set(id, null);
			return null;
		}
	}
	const visitedRefs = /* @__PURE__ */ new Set();
	function extractNode(node, ctx = {
		inTable: false,
		inCode: false
	}) {
		if (node === null || node === void 0) return "";
		if (typeof node === "string") {
			const refMatch = node.match(/^\$L([0-9a-f]+)$/i);
			if (refMatch) {
				const refId = refMatch[1];
				if (visitedRefs.has(refId)) return "";
				visitedRefs.add(refId);
				const refNode = getParsedChunk(refId);
				const result = refNode ? extractNode(refNode, ctx) : "";
				visitedRefs.delete(refId);
				return result;
			}
			if (!ctx.inCode && (node === "$undefined" || node === "$" || /^\$[A-Z]/.test(node))) return "";
			return node.trim() ? node : "";
		}
		if (typeof node === "number") return String(node);
		if (typeof node === "boolean") return "";
		if (!Array.isArray(node)) return "";
		if (node[0] === "$" && typeof node[1] === "string") {
			const tag = node[1];
			const props = node[3] || {};
			if ([
				"script",
				"style",
				"svg",
				"path",
				"circle",
				"link",
				"meta",
				"template",
				"button",
				"input",
				"nav",
				"footer",
				"aside"
			].includes(tag)) return "";
			if (tag.startsWith("$L")) {
				const refId = tag.slice(2);
				if (visitedRefs.has(refId)) return "";
				if (props.baseId && props.children) return `## ${String(props.children)}\n\n`;
				visitedRefs.add(refId);
				const refNode = getParsedChunk(refId);
				let result = "";
				if (refNode) result = extractNode(refNode, ctx);
				else if (props.children) result = extractNode(props.children, ctx);
				visitedRefs.delete(refId);
				return result;
			}
			const children = props.children;
			const content = children ? extractNode(children, ctx) : "";
			switch (tag) {
				case "h1": return `# ${content.trim()}\n\n`;
				case "h2": return `## ${content.trim()}\n\n`;
				case "h3": return `### ${content.trim()}\n\n`;
				case "h4": return `#### ${content.trim()}\n\n`;
				case "h5": return `##### ${content.trim()}\n\n`;
				case "h6": return `###### ${content.trim()}\n\n`;
				case "p": return ctx.inTable ? content : `${content.trim()}\n\n`;
				case "code": {
					const codeContent = children ? extractNode(children, {
						...ctx,
						inCode: true
					}) : "";
					return ctx.inCode ? codeContent : `\`${codeContent}\``;
				}
				case "pre": return "```\n" + (children ? extractNode(children, {
					...ctx,
					inCode: true
				}) : "") + "\n```\n\n";
				case "strong":
				case "b": return `**${content}**`;
				case "em":
				case "i": return `*${content}*`;
				case "li": return `- ${content.trim()}\n`;
				case "ul":
				case "ol": return content + "\n";
				case "blockquote": return `> ${content.trim()}\n\n`;
				case "table": return extractTable(node) + "\n";
				case "thead":
				case "tbody":
				case "tr":
				case "th":
				case "td": return content;
				case "div":
					if (props.role === "alert" || props["data-slot"] === "alert") return `> ${content.trim()}\n\n`;
					return content;
				case "a": {
					const href = props.href;
					return href && !href.startsWith("#") ? `[${content}](${href})` : content;
				}
				default: return content;
			}
		}
		return node.map((n) => extractNode(n, ctx)).join("");
	}
	function extractTable(tableNode) {
		const props = tableNode[3] || {};
		const rows = [];
		let headerRowCount = 0;
		function walkTable(node, isHeader = false) {
			if (node === null || node === void 0) return;
			if (typeof node === "string") {
				const refMatch = node.match(/^\$L([0-9a-f]+)$/i);
				if (refMatch && !visitedRefs.has(refMatch[1])) {
					visitedRefs.add(refMatch[1]);
					const refNode = getParsedChunk(refMatch[1]);
					if (refNode) walkTable(refNode, isHeader);
					visitedRefs.delete(refMatch[1]);
				}
				return;
			}
			if (!Array.isArray(node)) return;
			if (node[0] === "$") {
				const tag = node[1];
				const nodeProps = node[3] || {};
				if (tag.startsWith("$L")) {
					const refId = tag.slice(2);
					if (!visitedRefs.has(refId)) {
						visitedRefs.add(refId);
						const refNode = getParsedChunk(refId);
						if (refNode) walkTable(refNode, isHeader);
						visitedRefs.delete(refId);
					}
					return;
				}
				if (tag === "thead") walkTable(nodeProps.children, true);
				else if (tag === "tbody") walkTable(nodeProps.children, false);
				else if (tag === "tr") {
					const cells = [];
					walkCells(nodeProps.children, cells);
					if (cells.length > 0) {
						rows.push(cells);
						if (isHeader) headerRowCount++;
					}
				} else walkTable(nodeProps.children, isHeader);
			} else for (const child of node) walkTable(child, isHeader);
		}
		function walkCells(node, cells) {
			if (node === null || node === void 0) return;
			if (typeof node === "string") {
				const refMatch = node.match(/^\$L([0-9a-f]+)$/i);
				if (refMatch && !visitedRefs.has(refMatch[1])) {
					visitedRefs.add(refMatch[1]);
					const refNode = getParsedChunk(refMatch[1]);
					if (refNode) walkCells(refNode, cells);
					visitedRefs.delete(refMatch[1]);
				}
				return;
			}
			if (!Array.isArray(node)) return;
			if (node[0] === "$" && (node[1] === "td" || node[1] === "th")) {
				const text = extractNode((node[3] || {}).children, {
					inTable: true,
					inCode: false
				}).trim().replace(/\n/g, " ").replace(/\\/g, "\\\\").replace(/\|/g, "\\|");
				cells.push(text);
			} else if (node[0] === "$" && typeof node[1] === "string" && node[1].startsWith("$L")) {
				const refId = node[1].slice(2);
				if (!visitedRefs.has(refId)) {
					visitedRefs.add(refId);
					const refNode = getParsedChunk(refId);
					if (refNode) walkCells(refNode, cells);
					visitedRefs.delete(refId);
				}
			} else for (const child of node) walkCells(child, cells);
		}
		walkTable(props.children);
		if (rows.length === 0) return "";
		const colCount = Math.max(...rows.map((r) => r.length));
		let md = "";
		for (let i = 0; i < rows.length; i++) {
			const row = rows[i].concat(Array(colCount - rows[i].length).fill(""));
			md += "| " + row.join(" | ") + " |\n";
			if (i === headerRowCount - 1 || headerRowCount === 0 && i === 0) md += "| " + Array(colCount).fill("---").join(" | ") + " |\n";
		}
		return md;
	}
	const mainChunk = getParsedChunk("23");
	if (mainChunk) {
		const content = extractNode(mainChunk);
		if (content.trim().length > 100) return {
			title,
			content: content.replace(/\n{3,}/g, "\n\n").trim()
		};
	}
	const contentParts = [];
	for (const [id] of chunkMap) {
		if (id === "23") continue;
		const parsed = getParsedChunk(id);
		if (!parsed) continue;
		visitedRefs.clear();
		const text = extractNode(parsed);
		if (text.trim().length > 50 && !text.includes("page was not found") && !text.includes("404")) contentParts.push({
			order: parseInt(id, 16),
			text: text.trim()
		});
	}
	if (contentParts.length === 0) return null;
	contentParts.sort((a, b) => a.order - b.order);
	const seen = /* @__PURE__ */ new Set();
	const uniqueParts = [];
	for (const part of contentParts) {
		const key = part.text.slice(0, 150);
		if (!seen.has(key)) {
			seen.add(key);
			uniqueParts.push(part.text);
		}
	}
	const content = uniqueParts.join("\n\n").replace(/\n{3,}/g, "\n\n").trim();
	return content.length > 100 ? {
		title,
		content
	} : null;
}
//#endregion
export { extractRSCContent };

//# sourceMappingURL=rsc-extract-BEk9_U1k.mjs.map