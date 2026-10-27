window.__ModuleLoader__.load({
	id: "dsh-academic-review",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		let react_jsx_runtime = require("react/jsx-runtime");
		let react = require("react");
		//#region lib/client/review-data.js
		/**
		* Read-only data adapter between the Academic Review panel and the plugin's
		* review-state web surface (docs/PORT_SPEC.md section 3). Every read goes
		* through the three authenticated GET routes registered by src/web.ts; the
		* browser never touches the filesystem and there are no mutation calls.
		*
		* @module dsh-academic-review/client
		*/
		/** Route prefix served by the plugin's web surface. */
		const REVIEWS_API_ROOT = "/plugins/dsh-academic-review/reviews";
		/** The five Phase 1 seat ids, in panel order. */
		const SEAT_IDS = [
			"eic",
			"methodology",
			"domain",
			"perspective",
			"da"
		];
		/** The three human checkpoints the review state machine reports. */
		const REVIEW_CHECKPOINTS = [
			"field_analysis_attachment",
			"panel_confirmation",
			"report_approval"
		];
		/** Narrow an unknown thrown value to a message. */
		function messageOf(error) {
			return error instanceof Error ? error.message : String(error);
		}
		/**
		* Checkpoint implied by a lifecycle status, or null when the review is not
		* waiting on a human (mirrors pendingCheckpointOf in src/state.ts).
		*/
		const CHECKPOINT_BY_STATUS = {
			created: "field_analysis_attachment",
			panel_configured: "field_analysis_attachment",
			awaiting_panel_confirmation: "panel_confirmation",
			awaiting_synthesis_approval: "report_approval"
		};
		/**
		* The checkpoint one review is waiting on, or null when it is not blocked on a
		* human. A string `pending_checkpoint` from the server wins; otherwise the
		* status decides, so the panel still shows the right card against a backend
		* that only serves a boolean.
		* @param review - review summary.
		* @returns checkpoint name or null.
		*/
		function checkpointOf(review) {
			const declared = review.pending_checkpoint;
			if (typeof declared === "string" && REVIEW_CHECKPOINTS.includes(declared)) return declared;
			return CHECKPOINT_BY_STATUS[review.status] ?? null;
		}
		/** Quote one argument value for the call text (JSON string form). */
		function q(value) {
			return JSON.stringify(value);
		}
		/**
		* The exact next call that clears one checkpoint.
		*
		* The panel never performs it: the text is shown so the user can hand it to
		* the model in the session, which keeps this surface strictly read-only.
		*
		* @param review - review summary (id plus seats, for the card count).
		* @param checkpoint - checkpoint being reported.
		* @returns exact call text and its requirement flags.
		*/
		function nextCallFor(review, checkpoint) {
			const reviewId = q(review.review_id);
			switch (checkpoint) {
				case "field_analysis_attachment": {
					const seats = review.seats.map((seat) => seat.seat_id).filter((seatId) => seatId !== "da");
					const cards = (seats.length > 0 ? seats : [
						"eic",
						"methodology",
						"domain",
						"perspective"
					]).map((seatId) => "    { seat: " + q(seatId) + ", identity: \"<role identity>\", expertise: \"<expertise>\", focus: \"<review focus>\" }");
					return {
						call: [
							"academic_review_confirm({",
							"  review_id: " + reviewId + ",",
							"  action: \"attach\",",
							"  primary_discipline: \"<primary discipline from the field analysis>\",",
							"  secondary_disciplines: [\"<secondary discipline>\"],",
							"  research_paradigm: \"<research paradigm>\",",
							"  methodology_type: \"<methodology type>\",",
							"  target_journal_tier: \"<target journal tier>\",",
							"  paper_maturity: \"<paper maturity>\",",
							"  configuration_cards: [",
							cards.join(",\n"),
							"  ]",
							"})",
							"// then, once the user has seen and approved the cards:",
							"academic_review_confirm({",
							"  review_id: " + reviewId + ",",
							"  action: \"confirm\"",
							"})"
						].join("\n"),
						requiresDevilsAdvocateAdjudication: false
					};
				}
				case "panel_confirmation": return {
					call: [
						"academic_review_confirm({",
						"  review_id: " + reviewId + ",",
						"  action: \"confirm\"",
						"  // configuration_cards: [ ... ]  // optional, only when the user edits a card",
						"})"
					].join("\n"),
					requiresDevilsAdvocateAdjudication: false
				};
				case "report_approval": return {
					call: [
						"academic_review_report({",
						"  review_id: " + reviewId + ",",
						"  approve: true,",
						"  da_adjudications: [",
						"    {",
						"      finding_id: \"<Devil's Advocate CRITICAL finding id>\",",
						"      outcome: \"validated\",  // validated | rejected | unresolved",
						"      rationale: \"<why the finding holds, or why it does not>\"",
						"    }",
						"  ]",
						"})"
					].join("\n"),
					requiresDevilsAdvocateAdjudication: true
				};
			}
		}
		/**
		* Fetch every review under the workspace's state root.
		* @returns classified load outcome; never throws.
		*/
		async function fetchReviews() {
			try {
				const response = await fetch(REVIEWS_API_ROOT, { headers: { accept: "application/json" } });
				if (response.status === 401 || response.status === 403) return { kind: "unauthorized" };
				if (response.status === 503) return { kind: "unauthorized" };
				if (!response.ok) return {
					kind: "error",
					message: "HTTP " + String(response.status)
				};
				const reviews = (await response.json())?.reviews;
				if (!Array.isArray(reviews)) return {
					kind: "error",
					message: "malformed response"
				};
				return {
					kind: "ok",
					reviews
				};
			} catch (error) {
				return {
					kind: "error",
					message: messageOf(error)
				};
			}
		}
		/**
		* Fetch the editorial decision letter markdown for one review.
		* @param reviewId - review id.
		*/
		async function fetchReport(reviewId) {
			try {
				const response = await fetch("/plugins/dsh-academic-review/reviews/" + encodeURIComponent(reviewId) + "/report", { headers: { accept: "application/json" } });
				if (response.status === 401 || response.status === 403 || response.status === 503) return { kind: "unauthorized" };
				if (response.status === 404) return { kind: "not-found" };
				if (response.status === 409) return { kind: "not-ready" };
				if (!response.ok) return {
					kind: "error",
					message: "HTTP " + String(response.status)
				};
				const markdown = (await response.json())?.markdown;
				if (typeof markdown !== "string") return {
					kind: "error",
					message: "malformed response"
				};
				return {
					kind: "ok",
					markdown
				};
			} catch (error) {
				return {
					kind: "error",
					message: messageOf(error)
				};
			}
		}
		/**
		* Open the decision letter in a new browser tab (JSON body converted to a
		* plain-text document); fails soft when the report is not on disk yet.
		* @param reviewId - review id.
		*/
		async function openReport(reviewId) {
			const load = await fetchReport(reviewId);
			if (load.kind !== "ok") return load;
			const blob = new Blob([load.markdown], { type: "text/markdown;charset=utf-8" });
			const url = URL.createObjectURL(blob);
			if (window.open(url, "_blank", "noopener") === null) window.location.assign(url);
			window.setTimeout(() => URL.revokeObjectURL(url), 6e4);
			return load;
		}
		//#endregion
		//#region lib/client/letter-markdown.js
		/** Inline spans recognised first: code, bold, then star emphasis. */
		const INLINE_RE = /(`[^`\n]*`|\*\*[^*\n]+\*\*|\*[^*\n]+\*)/g;
		/** Word characters: an underscore next to one of these is literal, not emphasis. */
		const WORD_CHAR_RE = /[\p{L}\p{N}_]/u;
		/** Heading line. */
		const HEADING_RE = /^ {0,3}(#{1,6})\s+(.*)$/;
		/** Horizontal rule. */
		const RULE_RE = /^ {0,3}(?:-{3,}|\*{3,}|_{3,})\s*$/;
		/** Block-quote line. */
		const QUOTE_RE = /^ {0,3}>\s?(.*)$/;
		/** List item line, with its indentation depth. */
		const LIST_RE = /^(\s*)(?:[-*+]|\d+[.)])\s+(.*)$/;
		/** Fenced code opener. */
		const FENCE_RE = /^ {0,3}(```|~~~)/;
		/** Table separator cell. */
		const TABLE_SEPARATOR_RE = /^:?-{2,}:?$/;
		/**
		* Split one line into inline React nodes. Every unrecognised span stays a
		* plain string, so React escapes it and markup from the model can never
		* become a live node.
		* @param text - inline markdown.
		* @param keyPrefix - stable key prefix.
		* @returns inline nodes.
		*/
		function inlineNodes(text, keyPrefix) {
			const parts = text.split(INLINE_RE);
			const nodes = [];
			for (let index = 0; index < parts.length; index += 1) {
				const part = parts[index];
				if (part === void 0 || part === "") continue;
				const key = keyPrefix + "i" + String(index);
				if (part.length > 2 && part.startsWith("`") && part.endsWith("`")) nodes.push((0, react_jsx_runtime.jsx)("code", { children: part.slice(1, -1) }, key));
				else if (part.length > 4 && (part.startsWith("**") || part.startsWith("__")) && part.endsWith(part.slice(0, 2))) nodes.push((0, react_jsx_runtime.jsx)("strong", { children: part.slice(2, -2) }, key));
				else if (part.length > 2 && part.startsWith("*") && part.endsWith("*")) nodes.push((0, react_jsx_runtime.jsx)("em", { children: part.slice(1, -1) }, key));
				else nodes.push(...underscoreEmphasis(part, key + "u"));
			}
			return nodes;
		}
		/**
		* Emphasise `_text_` spans, but only where the underscores are real
		* delimiters: intraword underscores (minor_revision, snake_case ids) stay
		* literal text, as markdown specifies.
		* @param text - plain fragment.
		* @param keyPrefix - stable key prefix.
		* @returns nodes for that fragment.
		*/
		function underscoreEmphasis(text, keyPrefix) {
			const nodes = [];
			let emitted = 0;
			let scan = 0;
			let literalFrom = 0;
			while (scan < text.length) {
				const open = text.indexOf("_", scan);
				if (open === -1) break;
				const before = open === 0 ? "" : text.charAt(open - 1);
				let close = -1;
				if (!WORD_CHAR_RE.test(before)) {
					const candidate = text.indexOf("_", open + 1);
					if (candidate !== -1) {
						const after = candidate + 1 >= text.length ? "" : text.charAt(candidate + 1);
						if (candidate !== open + 1 && !WORD_CHAR_RE.test(after)) close = candidate;
					}
				}
				if (close === -1) {
					scan = open + 1;
					continue;
				}
				if (open > literalFrom) nodes.push(text.slice(literalFrom, open));
				nodes.push((0, react_jsx_runtime.jsx)("em", { children: text.slice(open + 1, close) }, keyPrefix + "e" + String(emitted)));
				emitted += 1;
				scan = close + 1;
				literalFrom = close + 1;
			}
			if (literalFrom < text.length) nodes.push(text.slice(literalFrom));
			return nodes;
		}
		/** Split one table row into trimmed cells (outer pipes dropped). */
		function tableCells(line) {
			let body = line.trim();
			if (body.startsWith("|")) body = body.slice(1);
			if (body.endsWith("|")) body = body.slice(0, -1);
			return body.split("|").map((cell) => cell.trim());
		}
		/** Whether the line starts a pipe table (row, separator row, ...). */
		function isTableStart(lines, index) {
			const head = lines[index];
			const divider = lines[index + 1];
			if (head === void 0 || divider === void 0) return false;
			if (!head.includes("|") || !divider.includes("|")) return false;
			const cells = tableCells(divider);
			return cells.length > 0 && cells.every((cell) => TABLE_SEPARATOR_RE.test(cell));
		}
		/** Nest flat (depth, text) rows into a list tree. */
		function buildListTree(rows) {
			const root = [];
			const stack = [{
				depth: 0,
				items: root
			}];
			for (const row of rows) {
				while (stack.length > 1 && row.depth < (stack[stack.length - 1]?.depth ?? 0)) stack.pop();
				const top = stack[stack.length - 1];
				if (top === void 0) continue;
				if (row.depth > top.depth && top.items.length > 0) {
					const parent = top.items[top.items.length - 1];
					if (parent !== void 0) stack.push({
						depth: row.depth,
						items: parent.children
					});
				}
				stack[stack.length - 1]?.items.push({
					text: row.text,
					children: []
				});
			}
			return root;
		}
		/**
		* Parse the letter into blocks.
		* @param markdown - letter text.
		* @returns parsed blocks, in order.
		*/
		function parseBlocks(markdown) {
			const lines = markdown.replace(/\r\n?/g, "\n").split("\n");
			const blocks = [];
			let index = 0;
			while (index < lines.length) {
				const line = lines[index] ?? "";
				if (line.trim() === "") {
					index += 1;
					continue;
				}
				const fence = FENCE_RE.exec(line);
				if (fence !== null) {
					const marker = fence[1] ?? "```";
					const body = [];
					index += 1;
					while (index < lines.length) {
						const current = lines[index] ?? "";
						if (current.trim().startsWith(marker)) {
							index += 1;
							break;
						}
						body.push(current);
						index += 1;
					}
					blocks.push({
						kind: "code",
						text: body.join("\n")
					});
					continue;
				}
				const heading = HEADING_RE.exec(line);
				if (heading !== null) {
					blocks.push({
						kind: "heading",
						level: (heading[1] ?? "#").length,
						text: (heading[2] ?? "").trim()
					});
					index += 1;
					continue;
				}
				if (RULE_RE.test(line)) {
					blocks.push({ kind: "rule" });
					index += 1;
					continue;
				}
				if (QUOTE_RE.test(line)) {
					const quoted = [];
					while (index < lines.length) {
						const current = lines[index] ?? "";
						const match = QUOTE_RE.exec(current);
						if (match === null) break;
						quoted.push((match[1] ?? "").trim());
						index += 1;
					}
					blocks.push({
						kind: "quote",
						text: quoted.join(" ").trim()
					});
					continue;
				}
				if (isTableStart(lines, index)) {
					const header = tableCells(line);
					index += 2;
					const rows = [];
					while (index < lines.length) {
						const current = lines[index] ?? "";
						if (current.trim() === "" || !current.includes("|")) break;
						rows.push(tableCells(current));
						index += 1;
					}
					blocks.push({
						kind: "table",
						header,
						rows
					});
					continue;
				}
				if (LIST_RE.exec(line) !== null) {
					const ordered = /^\d/.test(line.trim());
					const rows = [];
					while (index < lines.length) {
						const current = lines[index] ?? "";
						const match = LIST_RE.exec(current);
						if (match === null) break;
						rows.push({
							depth: Math.floor((match[1] ?? "").replace(/\t/g, "  ").length / 2),
							text: (match[2] ?? "").trim()
						});
						index += 1;
					}
					blocks.push({
						kind: "list",
						ordered,
						items: buildListTree(rows)
					});
					continue;
				}
				const paragraph = [];
				while (index < lines.length) {
					const current = lines[index] ?? "";
					if (current.trim() === "") break;
					if (paragraph.length > 0 && (HEADING_RE.test(current) || RULE_RE.test(current) || QUOTE_RE.test(current) || LIST_RE.test(current) || isTableStart(lines, index) || FENCE_RE.test(current))) break;
					paragraph.push(current.trim());
					index += 1;
				}
				blocks.push({
					kind: "paragraph",
					text: paragraph.join(" ")
				});
			}
			return blocks;
		}
		/** Render a nested list body. */
		function renderListItems(items, keyPrefix) {
			return items.map((item, index) => {
				const key = keyPrefix + "l" + String(index);
				return (0, react_jsx_runtime.jsxs)("li", { children: [inlineNodes(item.text, key + "-"), item.children.length > 0 ? (0, react_jsx_runtime.jsx)("ul", { children: renderListItems(item.children, key + "-") }) : null] }, key);
			});
		}
		/** Render one parsed block. */
		function renderBlock(block, key) {
			switch (block.kind) {
				case "heading": {
					const inline = inlineNodes(block.text, key + "-");
					switch (block.level) {
						case 1: return (0, react_jsx_runtime.jsx)("h1", { children: inline }, key);
						case 2: return (0, react_jsx_runtime.jsx)("h2", { children: inline }, key);
						case 3: return (0, react_jsx_runtime.jsx)("h3", { children: inline }, key);
						case 4: return (0, react_jsx_runtime.jsx)("h4", { children: inline }, key);
						case 5: return (0, react_jsx_runtime.jsx)("h5", { children: inline }, key);
						default: return (0, react_jsx_runtime.jsx)("h6", { children: inline }, key);
					}
				}
				case "paragraph": return (0, react_jsx_runtime.jsx)("p", { children: inlineNodes(block.text, key + "-") }, key);
				case "list": {
					const body = renderListItems(block.items, key + "-");
					return block.ordered ? (0, react_jsx_runtime.jsx)("ol", { children: body }, key) : (0, react_jsx_runtime.jsx)("ul", { children: body }, key);
				}
				case "quote": return (0, react_jsx_runtime.jsx)("blockquote", { children: inlineNodes(block.text, key + "-") }, key);
				case "table": return (0, react_jsx_runtime.jsxs)("table", { children: [(0, react_jsx_runtime.jsx)("thead", { children: (0, react_jsx_runtime.jsx)("tr", { children: block.header.map((cell, index) => (0, react_jsx_runtime.jsx)("th", { children: inlineNodes(cell, key + "-h" + String(index) + "-") }, key + "-h" + String(index))) }) }), (0, react_jsx_runtime.jsx)("tbody", { children: block.rows.map((row, rowIndex) => (0, react_jsx_runtime.jsx)("tr", { children: row.map((cell, cellIndex) => (0, react_jsx_runtime.jsx)("td", { children: inlineNodes(cell, key + "-r" + String(rowIndex) + "c" + String(cellIndex) + "-") }, key + "-r" + String(rowIndex) + "c" + String(cellIndex))) }, key + "-r" + String(rowIndex))) })] }, key);
				case "rule": return (0, react_jsx_runtime.jsx)("hr", {}, key);
				case "code": return (0, react_jsx_runtime.jsx)("pre", { children: (0, react_jsx_runtime.jsx)("code", { children: block.text }) }, key);
			}
		}
		/**
		* Render letter markdown as React nodes (never as HTML).
		* @param markdown - editorial decision letter.
		* @returns one element per parsed block.
		*/
		function renderLetter(markdown) {
			return parseBlocks(markdown).map((block, index) => renderBlock(block, "b" + String(index)));
		}
		//#endregion
		//#region \0dsh-css:D:\Deepseek\dsh-academic-review\src\client\AcademicReviewPanel.module.css.mjs
		const css = ".eL81Mq_panel{height:100%;color:inherit;flex-direction:column;gap:12px;padding:16px;font-size:13px;display:flex;overflow-y:auto}.eL81Mq_panelHeader{flex-direction:column;gap:4px;display:flex}.eL81Mq_panelTitle{margin:0;font-size:15px;font-weight:600}.eL81Mq_panelDescription{opacity:.7;margin:0}.eL81Mq_refreshButton{color:inherit;cursor:pointer;background:0 0;border:1px solid;border-radius:6px;align-self:flex-start;margin-top:4px;padding:4px 10px}.eL81Mq_refreshButton:hover{opacity:.8}.eL81Mq_stateText{text-align:center;opacity:.7;margin:24px 0}.eL81Mq_emptyState{text-align:center;opacity:.8;border:1px dashed;border-radius:10px;margin:32px 8px;padding:24px}.eL81Mq_emptyTitle{margin:0 0 6px;font-weight:600}.eL81Mq_emptyBody{opacity:.7;margin:0}.eL81Mq_reviewList{flex-direction:column;gap:12px;display:flex}.eL81Mq_reviewCard{border:1px solid #80808059;border-radius:10px;flex-direction:column;gap:8px;padding:12px;display:flex}.eL81Mq_reviewHeader{flex-wrap:wrap;align-items:center;gap:8px;display:flex}.eL81Mq_reviewTitle{margin:0;font-family:ui-monospace,monospace;font-size:13px;font-weight:600}.eL81Mq_statusChip{white-space:nowrap;border:1px solid #80808080;border-radius:999px;padding:1px 8px;font-size:11px;display:inline-block}.eL81Mq_statusChip[data-status=report_ready],.eL81Mq_statusChip[data-status=submitted]{color:#1a7f37;border-color:#1a7f37}.eL81Mq_statusChip[data-status=awaiting_panel_confirmation],.eL81Mq_statusChip[data-status=awaiting_synthesis_approval]{color:#9a6700;border-color:#9a6700}.eL81Mq_statusChip[data-status=failed]{color:#cf222e;border-color:#cf222e}.eL81Mq_checkpointBadge{color:#9a6700;white-space:nowrap;background:#9a67001f;border-radius:999px;padding:1px 8px;font-size:11px;display:inline-block}.eL81Mq_facts{gap:18px;margin:0;display:flex}.eL81Mq_facts div{gap:6px;display:flex}.eL81Mq_facts dt{opacity:.6}.eL81Mq_facts dd{margin:0;font-weight:500}.eL81Mq_seatHeading{opacity:.75;text-transform:uppercase;letter-spacing:.04em;margin:4px 0 0;font-size:12px;font-weight:600}.eL81Mq_seatTable{border-collapse:collapse;width:100%}.eL81Mq_seatRow{border-top:1px solid #80808033}.eL81Mq_seatRow td{vertical-align:top;padding:6px 4px}.eL81Mq_seatName{width:45%;font-weight:500}.eL81Mq_findings{font-variant-numeric:tabular-nums}.eL81Mq_muted{opacity:.55}.eL81Mq_reviewFooter{justify-content:flex-end;display:flex}.eL81Mq_reportButton{color:#fff;cursor:pointer;background:#4078c0;border:none;border-radius:6px;padding:5px 14px}.eL81Mq_reportButton:disabled{opacity:.6;cursor:default}.eL81Mq_checkpointCard{background:#9a670014;border:1px solid #9a67008c;border-left-width:4px;border-radius:8px;flex-direction:column;gap:6px;padding:10px 12px;display:flex}.eL81Mq_checkpointHeading{color:#9a6700;margin:0;font-size:12px;font-weight:600}.eL81Mq_checkpointBody{opacity:.85;margin:0}.eL81Mq_checkpointRequirement{opacity:.85;margin:0;font-size:12px}.eL81Mq_checkpointLabel{opacity:.6;text-transform:uppercase;letter-spacing:.04em;margin:2px 0 0;font-size:11px;font-weight:600}.eL81Mq_callBlock{white-space:pre;background:#8080801a;border:1px solid #80808059;border-radius:6px;margin:0;padding:8px 10px;font-family:ui-monospace,monospace;font-size:11px;line-height:1.45;overflow-x:auto}.eL81Mq_checkpointActions{flex-wrap:wrap;align-items:center;gap:8px;display:flex}.eL81Mq_copyButton{color:inherit;cursor:pointer;background:0 0;border:1px solid;border-radius:6px;padding:3px 10px;font-size:11px}.eL81Mq_copyButton:hover{opacity:.8}.eL81Mq_copyButton[data-copy-state=copied]{color:#1a7f37;border-color:#1a7f37}.eL81Mq_copyButton[data-copy-state=failed]{color:#cf222e;border-color:#cf222e}.eL81Mq_letterSection{border-top:1px solid #80808040;flex-direction:column;gap:6px;padding-top:8px;display:flex}.eL81Mq_letterHeading{opacity:.75;text-transform:uppercase;letter-spacing:.04em;margin:0;font-size:12px;font-weight:600}.eL81Mq_letter{font-size:12px;line-height:1.5;overflow-x:auto}.eL81Mq_letter h1{margin:10px 0 6px;font-size:14px;font-weight:600}.eL81Mq_letter h2{margin:12px 0 4px;font-size:13px;font-weight:600}.eL81Mq_letter h3,.eL81Mq_letter h4,.eL81Mq_letter h5,.eL81Mq_letter h6{opacity:.9;margin:10px 0 4px;font-size:12px;font-weight:600}.eL81Mq_letter p{margin:0 0 6px}.eL81Mq_letter ul,.eL81Mq_letter ol{margin:0 0 6px;padding-left:18px}.eL81Mq_letter li{margin:2px 0}.eL81Mq_letter blockquote{opacity:.85;border-left:3px solid #80808080;margin:0 0 6px;padding:4px 10px}.eL81Mq_letter table{border-collapse:collapse;font-variant-numeric:tabular-nums;width:100%;margin:4px 0 8px}.eL81Mq_letter th,.eL81Mq_letter td{text-align:left;vertical-align:top;border-top:1px solid #80808040;padding:4px 6px}.eL81Mq_letter code{background:#80808026;border-radius:4px;padding:0 3px;font-family:ui-monospace,monospace}.eL81Mq_letter pre{background:#8080801a;border:1px solid #8080804d;border-radius:6px;margin:0 0 6px;padding:8px 10px;overflow-x:auto}.eL81Mq_letter pre code{background:0 0;padding:0}.eL81Mq_letter hr{border:none;border-top:1px solid #80808059;margin:10px 0}";
		const tagId = "dsh-academic-review/AcademicReviewPanel.module.css";
		if (typeof document !== "undefined" && document.querySelector("style[data-plugin-css=" + JSON.stringify(tagId) + "]") === null) {
			const tag = document.createElement("style");
			tag.dataset.plugin = "dsh-academic-review";
			tag.dataset.pluginCss = tagId;
			tag.textContent = css;
			document.head.appendChild(tag);
		}
		var AcademicReviewPanel_module_css_default = {
			"callBlock": "eL81Mq_callBlock",
			"checkpointActions": "eL81Mq_checkpointActions",
			"checkpointBadge": "eL81Mq_checkpointBadge",
			"checkpointBody": "eL81Mq_checkpointBody",
			"checkpointCard": "eL81Mq_checkpointCard",
			"checkpointHeading": "eL81Mq_checkpointHeading",
			"checkpointLabel": "eL81Mq_checkpointLabel",
			"checkpointRequirement": "eL81Mq_checkpointRequirement",
			"copyButton": "eL81Mq_copyButton",
			"emptyBody": "eL81Mq_emptyBody",
			"emptyState": "eL81Mq_emptyState",
			"emptyTitle": "eL81Mq_emptyTitle",
			"facts": "eL81Mq_facts",
			"findings": "eL81Mq_findings",
			"letter": "eL81Mq_letter",
			"letterHeading": "eL81Mq_letterHeading",
			"letterSection": "eL81Mq_letterSection",
			"muted": "eL81Mq_muted",
			"panel": "eL81Mq_panel",
			"panelDescription": "eL81Mq_panelDescription",
			"panelHeader": "eL81Mq_panelHeader",
			"panelTitle": "eL81Mq_panelTitle",
			"refreshButton": "eL81Mq_refreshButton",
			"reportButton": "eL81Mq_reportButton",
			"reviewCard": "eL81Mq_reviewCard",
			"reviewFooter": "eL81Mq_reviewFooter",
			"reviewHeader": "eL81Mq_reviewHeader",
			"reviewList": "eL81Mq_reviewList",
			"reviewTitle": "eL81Mq_reviewTitle",
			"seatHeading": "eL81Mq_seatHeading",
			"seatName": "eL81Mq_seatName",
			"seatRow": "eL81Mq_seatRow",
			"seatTable": "eL81Mq_seatTable",
			"stateText": "eL81Mq_stateText",
			"statusChip": "eL81Mq_statusChip"
		};
		//#endregion
		//#region lib/client/AcademicReviewPanel.js
		/**
		* Academic Review panel: review id, seats, findings tally, the pending human
		* checkpoint and (once approved) the rendered editorial decision letter.
		*
		* The panel is strictly read-only: it issues GET requests to the plugin's
		* three read-only routes, never calls a write path, and shows the exact tool
		* call the user still has to run in the session.
		*/
		/** Poll cadence while the panel is visible (ms). */
		const POLL_MS = 1e4;
		/** How long the copy button keeps its result label (ms). */
		const COPY_FEEDBACK_MS = 2400;
		/** Seats the synthesizer section stands in for (not a panel seat). */
		const SYNTHESIS_STATUSES = /* @__PURE__ */ new Set([
			"all_submitted",
			"awaiting_synthesis_approval",
			"report_ready"
		]);
		/** Stable empty list so effect deps cannot churn. */
		const NO_REVIEWS = [];
		/** Small observable used to gate polling on document visibility. */
		function visibilitySnapshot() {
			return typeof document === "undefined" ? true : !document.hidden;
		}
		function subscribeVisibility(onChange) {
			if (typeof document === "undefined") return () => {};
			document.addEventListener("visibilitychange", onChange);
			return () => document.removeEventListener("visibilitychange", onChange);
		}
		/**
		* Copy text to the clipboard. Browser-only, best effort: a host without the
		* async clipboard API reports failure so the caller can ask for a manual copy.
		* @param value - text to copy.
		* @returns whether the clipboard accepted it.
		*/
		async function copyText(value) {
			try {
				if (typeof navigator === "undefined") return false;
				const clipboard = navigator.clipboard;
				if (clipboard === void 0 || typeof clipboard.writeText !== "function") return false;
				await clipboard.writeText(value);
				return true;
			} catch {
				return false;
			}
		}
		/** Format the update timestamp in the viewer's locale, best effort. */
		function formatTime(iso) {
			const date = new Date(iso);
			if (Number.isNaN(date.getTime())) return iso;
			try {
				return date.toLocaleString();
			} catch {
				return iso;
			}
		}
		/** Copy-to-clipboard button for one call text. */
		function CopyButton({ text, t }) {
			const [state, setState] = (0, react.useState)("idle");
			const timer = (0, react.useRef)(null);
			(0, react.useEffect)(() => () => {
				if (timer.current !== null) window.clearTimeout(timer.current);
			}, []);
			const onCopy = (0, react.useCallback)(() => {
				(async () => {
					const copied = await copyText(text);
					setState(copied ? "copied" : "failed");
					if (timer.current !== null) window.clearTimeout(timer.current);
					timer.current = window.setTimeout(() => setState("idle"), COPY_FEEDBACK_MS);
				})();
			}, [text]);
			const label = state === "copied" ? t("checkpoint.copied") : state === "failed" ? t("checkpoint.copyFailed") : t("checkpoint.copy");
			return (0, react_jsx_runtime.jsx)("button", {
				type: "button",
				className: AcademicReviewPanel_module_css_default.copyButton,
				"data-testid": "copy-call",
				"data-copy-state": state,
				onClick: onCopy,
				children: label
			});
		}
		/** Prominent card naming the pending checkpoint and the exact next call. */
		function CheckpointCard({ review, checkpoint, t }) {
			const call = nextCallFor(review, checkpoint);
			return (0, react_jsx_runtime.jsxs)("div", {
				className: AcademicReviewPanel_module_css_default.checkpointCard,
				"data-testid": "checkpoint-card",
				"data-checkpoint": checkpoint,
				children: [
					(0, react_jsx_runtime.jsx)("p", {
						className: AcademicReviewPanel_module_css_default.checkpointHeading,
						children: t("checkpoint.heading." + checkpoint)
					}),
					(0, react_jsx_runtime.jsx)("p", {
						className: AcademicReviewPanel_module_css_default.checkpointBody,
						children: t("checkpoint.body." + checkpoint)
					}),
					call.requiresDevilsAdvocateAdjudication ? (0, react_jsx_runtime.jsx)("p", {
						className: AcademicReviewPanel_module_css_default.checkpointRequirement,
						"data-testid": "checkpoint-requirement",
						children: t("checkpoint.daRequirement")
					}) : null,
					(0, react_jsx_runtime.jsx)("p", {
						className: AcademicReviewPanel_module_css_default.checkpointLabel,
						children: t("checkpoint.nextCall")
					}),
					(0, react_jsx_runtime.jsx)("pre", {
						className: AcademicReviewPanel_module_css_default.callBlock,
						"data-testid": "next-call",
						children: (0, react_jsx_runtime.jsx)("code", { children: call.call })
					}),
					(0, react_jsx_runtime.jsxs)("div", {
						className: AcademicReviewPanel_module_css_default.checkpointActions,
						children: [(0, react_jsx_runtime.jsx)(CopyButton, {
							text: call.call,
							t
						}), (0, react_jsx_runtime.jsx)("span", {
							className: AcademicReviewPanel_module_css_default.muted,
							children: t("checkpoint.readOnlyNote")
						})]
					})
				]
			});
		}
		/** One seat row: role name, status chip, findings tally. */
		function SeatRow({ seat, t }) {
			const severity = seat.findings_by_severity ?? {};
			const tally = [
				"critical",
				"major",
				"minor",
				"comment"
			].filter((key) => (severity[key] ?? 0) > 0).map((key) => t("severity." + key) + " " + String(severity[key]));
			return (0, react_jsx_runtime.jsxs)("tr", {
				className: AcademicReviewPanel_module_css_default.seatRow,
				"data-seat": seat.seat_id,
				"data-status": seat.status,
				children: [
					(0, react_jsx_runtime.jsx)("td", {
						className: AcademicReviewPanel_module_css_default.seatName,
						children: t("seat.id." + seat.seat_id)
					}),
					(0, react_jsx_runtime.jsx)("td", { children: (0, react_jsx_runtime.jsx)("span", {
						className: AcademicReviewPanel_module_css_default.statusChip,
						"data-status": seat.status,
						children: t("seatStatus." + seat.status)
					}) }),
					(0, react_jsx_runtime.jsx)("td", {
						className: AcademicReviewPanel_module_css_default.findings,
						children: seat.findings_open === 0 ? (0, react_jsx_runtime.jsx)("span", {
							className: AcademicReviewPanel_module_css_default.muted,
							children: "0"
						}) : (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [String(seat.findings_open), tally.length > 0 ? (0, react_jsx_runtime.jsxs)("span", {
							className: AcademicReviewPanel_module_css_default.muted,
							children: [" · ", tally.join(" / ")]
						}) : null] })
					})
				]
			});
		}
		/** The editorial decision letter, fetched once and rendered as React nodes. */
		function ReportLetter({ reviewId, t }) {
			const [load, setLoad] = (0, react.useState)(null);
			(0, react.useEffect)(() => {
				let disposed = false;
				(async () => {
					const result = await fetchReport(reviewId);
					if (!disposed) setLoad(result);
				})();
				return () => {
					disposed = true;
				};
			}, [reviewId]);
			return (0, react_jsx_runtime.jsxs)("section", {
				className: AcademicReviewPanel_module_css_default.letterSection,
				"data-testid": "report-letter",
				"data-state": load === null ? "loading" : load.kind,
				children: [(0, react_jsx_runtime.jsx)("h4", {
					className: AcademicReviewPanel_module_css_default.letterHeading,
					children: t("report.heading")
				}), load === null ? (0, react_jsx_runtime.jsx)("p", {
					className: AcademicReviewPanel_module_css_default.stateText,
					"data-state": "report-loading",
					children: t("report.loading")
				}) : load.kind === "ok" ? load.markdown.trim() === "" ? (0, react_jsx_runtime.jsx)("p", {
					className: AcademicReviewPanel_module_css_default.muted,
					"data-state": "report-empty",
					children: t("report.empty")
				}) : (0, react_jsx_runtime.jsx)("div", {
					className: AcademicReviewPanel_module_css_default.letter,
					"data-testid": "letter-body",
					children: renderLetter(load.markdown)
				}) : load.kind === "not-ready" ? (0, react_jsx_runtime.jsx)("p", {
					className: AcademicReviewPanel_module_css_default.muted,
					"data-state": "report-not-ready",
					children: t("error.reportNotReady")
				}) : load.kind === "not-found" ? (0, react_jsx_runtime.jsx)("p", {
					className: AcademicReviewPanel_module_css_default.muted,
					"data-state": "report-not-found",
					children: t("error.notFound")
				}) : load.kind === "unauthorized" ? (0, react_jsx_runtime.jsx)("p", {
					className: AcademicReviewPanel_module_css_default.muted,
					"data-state": "report-unauthorized",
					children: t("panel.error")
				}) : (0, react_jsx_runtime.jsx)("p", {
					className: AcademicReviewPanel_module_css_default.stateText,
					"data-state": "report-error",
					children: t("error.reportLoadFailed", { message: load.message })
				})]
			});
		}
		/** One review card: header facts, checkpoint card, seat table, report. */
		function ReviewCard({ review, t, onOpenReport, reportBusy }) {
			const translate = t;
			const seats = (0, react.useMemo)(() => {
				const byId = new Map(review.seats.map((seat) => [seat.seat_id, seat]));
				return SEAT_IDS.map((id) => byId.get(id)).filter((seat) => seat !== void 0);
			}, [review.seats]);
			const reportReady = review.status === "report_ready";
			const checkpoint = checkpointOf(review);
			return (0, react_jsx_runtime.jsxs)("section", {
				className: AcademicReviewPanel_module_css_default.reviewCard,
				"data-review-id": review.review_id,
				"data-status": review.status,
				children: [
					(0, react_jsx_runtime.jsxs)("header", {
						className: AcademicReviewPanel_module_css_default.reviewHeader,
						children: [
							(0, react_jsx_runtime.jsx)("h3", {
								className: AcademicReviewPanel_module_css_default.reviewTitle,
								children: review.review_id
							}),
							(0, react_jsx_runtime.jsx)("span", {
								className: AcademicReviewPanel_module_css_default.statusChip,
								"data-status": review.status,
								children: translate("status." + review.status)
							}),
							checkpoint === null ? null : (0, react_jsx_runtime.jsxs)("span", {
								className: AcademicReviewPanel_module_css_default.checkpointBadge,
								title: translate("review.checkpointHint"),
								children: ["⏸ ", translate("review.checkpoint")]
							})
						]
					}),
					checkpoint === null ? null : (0, react_jsx_runtime.jsx)(CheckpointCard, {
						review,
						checkpoint,
						t: translate
					}),
					(0, react_jsx_runtime.jsxs)("dl", {
						className: AcademicReviewPanel_module_css_default.facts,
						children: [(0, react_jsx_runtime.jsxs)("div", { children: [(0, react_jsx_runtime.jsx)("dt", { children: translate("review.mode") }), (0, react_jsx_runtime.jsx)("dd", { children: review.mode })] }), (0, react_jsx_runtime.jsxs)("div", { children: [(0, react_jsx_runtime.jsx)("dt", { children: translate("review.updated") }), (0, react_jsx_runtime.jsx)("dd", { children: formatTime(review.updated_at) })] })]
					}),
					(0, react_jsx_runtime.jsx)("h4", {
						className: AcademicReviewPanel_module_css_default.seatHeading,
						children: translate("seat.heading")
					}),
					(0, react_jsx_runtime.jsx)("table", {
						className: AcademicReviewPanel_module_css_default.seatTable,
						children: (0, react_jsx_runtime.jsxs)("tbody", { children: [seats.map((seat) => (0, react_jsx_runtime.jsx)(SeatRow, {
							seat,
							t: translate
						}, seat.seat_id)), (0, react_jsx_runtime.jsxs)("tr", {
							className: AcademicReviewPanel_module_css_default.seatRow,
							"data-seat": "synthesis",
							"data-status": SYNTHESIS_STATUSES.has(review.status) ? "submitted" : "pending",
							children: [
								(0, react_jsx_runtime.jsx)("td", {
									className: AcademicReviewPanel_module_css_default.seatName,
									children: translate("seat.editorialSynthesizer")
								}),
								(0, react_jsx_runtime.jsx)("td", { children: (0, react_jsx_runtime.jsx)("span", {
									className: AcademicReviewPanel_module_css_default.statusChip,
									"data-status": SYNTHESIS_STATUSES.has(review.status) ? "submitted" : "pending",
									children: SYNTHESIS_STATUSES.has(review.status) ? translate("seatStatus.submitted") : translate("seatStatus.pending")
								}) }),
								(0, react_jsx_runtime.jsx)("td", {
									className: AcademicReviewPanel_module_css_default.findings,
									children: (0, react_jsx_runtime.jsx)("span", {
										className: AcademicReviewPanel_module_css_default.muted,
										children: "—"
									})
								})
							]
						})] })
					}),
					(0, react_jsx_runtime.jsx)("footer", {
						className: AcademicReviewPanel_module_css_default.reviewFooter,
						children: reportReady ? (0, react_jsx_runtime.jsx)("button", {
							type: "button",
							className: AcademicReviewPanel_module_css_default.reportButton,
							disabled: reportBusy,
							onClick: () => onOpenReport(review.review_id),
							children: translate("review.openReport")
						}) : (0, react_jsx_runtime.jsx)("span", {
							className: AcademicReviewPanel_module_css_default.muted,
							children: translate("review.noReport")
						})
					}),
					reportReady ? (0, react_jsx_runtime.jsx)(ReportLetter, {
						reviewId: review.review_id,
						t: translate
					}) : null
				]
			});
		}
		/** The Academic Review panel body: poll, list, empty/error/loading states. */
		function AcademicReviewPanel({ t }) {
			const visible = (0, react.useSyncExternalStore)(subscribeVisibility, visibilitySnapshot);
			const [load, setLoad] = (0, react.useState)(null);
			const [reload, setReload] = (0, react.useState)(0);
			const [reportBusy, setReportBusy] = (0, react.useState)(false);
			const [nonce, setNonce] = (0, react.useState)(0);
			(0, react.useEffect)(() => {
				if (!visible) return;
				let disposed = false;
				const load = async () => {
					const result = await fetchReviews();
					if (!disposed) setLoad(result);
				};
				load();
				const timer = window.setInterval(load, POLL_MS);
				return () => {
					disposed = true;
					window.clearInterval(timer);
				};
			}, [
				visible,
				reload,
				nonce
			]);
			const onOpenReport = (0, react.useCallback)(async (reviewId) => {
				setReportBusy(true);
				try {
					await openReport(reviewId);
				} finally {
					setReportBusy(false);
				}
			}, []);
			const refresh = (0, react.useCallback)(() => {
				setLoad(null);
				setReload((value) => value + 1);
			}, []);
			const reviews = load?.kind === "ok" ? load.reviews : NO_REVIEWS;
			return (0, react_jsx_runtime.jsxs)("div", {
				className: AcademicReviewPanel_module_css_default.panel,
				"data-testid": "academic-review-panel",
				children: [
					(0, react_jsx_runtime.jsxs)("header", {
						className: AcademicReviewPanel_module_css_default.panelHeader,
						children: [
							(0, react_jsx_runtime.jsx)("h2", {
								className: AcademicReviewPanel_module_css_default.panelTitle,
								children: t("panel.title")
							}),
							(0, react_jsx_runtime.jsx)("p", {
								className: AcademicReviewPanel_module_css_default.panelDescription,
								children: t("panel.description")
							}),
							(0, react_jsx_runtime.jsx)("button", {
								type: "button",
								className: AcademicReviewPanel_module_css_default.refreshButton,
								onClick: refresh,
								children: t("panel.refresh")
							})
						]
					}),
					load === null ? (0, react_jsx_runtime.jsx)("p", {
						className: AcademicReviewPanel_module_css_default.stateText,
						"data-state": "loading",
						children: t("panel.loading")
					}) : load.kind === "unauthorized" ? (0, react_jsx_runtime.jsx)("p", {
						className: AcademicReviewPanel_module_css_default.stateText,
						"data-state": "unauthorized",
						children: t("panel.error")
					}) : load.kind === "error" ? (0, react_jsx_runtime.jsx)("p", {
						className: AcademicReviewPanel_module_css_default.stateText,
						"data-state": "error",
						children: t("error.loadFailed", { message: load.message })
					}) : reviews.length === 0 ? (0, react_jsx_runtime.jsxs)("div", {
						className: AcademicReviewPanel_module_css_default.emptyState,
						"data-state": "empty",
						children: [(0, react_jsx_runtime.jsx)("p", {
							className: AcademicReviewPanel_module_css_default.emptyTitle,
							children: t("panel.emptyTitle")
						}), (0, react_jsx_runtime.jsx)("p", {
							className: AcademicReviewPanel_module_css_default.emptyBody,
							children: t("panel.emptyBody")
						})]
					}) : (0, react_jsx_runtime.jsx)("div", {
						className: AcademicReviewPanel_module_css_default.reviewList,
						children: reviews.map((review) => (0, react_jsx_runtime.jsx)(ReviewCard, {
							review,
							t,
							onOpenReport,
							reportBusy
						}, review.review_id))
					}),
					(0, react_jsx_runtime.jsx)("button", {
						type: "button",
						hidden: true,
						"aria-hidden": true,
						"data-nonce": nonce,
						onClick: () => setNonce((value) => value + 1)
					})
				]
			});
		}
		//#endregion
		//#region lib/client/locales.js
		/** `academicReview` namespace dictionaries for the Academic Review panel. */
		/** Dictionary namespace owned by the dsh-academic-review client plugin. */
		const ACADEMIC_REVIEW_LOCALE_NAMESPACE = "academicReview";
		/** Simplified Chinese dictionary (the key-set source of truth). */
		const zh = {
			"panel.title": "学术评审",
			"panel.description": "五席同行评审面板的运行状态（非官方 DSH 移植）。",
			"panel.emptyTitle": "当前工作区还没有评审",
			"panel.emptyBody": "在会话中让模型运行 academic-paper-reviewer 技能创建评审后，可在这里查看进度。",
			"panel.loading": "正在读取评审状态",
			"panel.error": "暂时无法读取评审状态，正在自动重试。",
			"panel.retry": "重新连接",
			"panel.refresh": "刷新",
			"review.mode": "模式",
			"review.status": "状态",
			"review.updated": "最近更新",
			"review.checkpoint": "等待人工确认",
			"review.checkpointHint": "评审正在等待你确认（面板配置或报告批准）。",
			"review.openReport": "打开评审报告",
			"review.noReport": "报告尚未生成",
			"checkpoint.heading.field_analysis_attachment": "确认点 1 · 附上领域分析",
			"checkpoint.heading.panel_confirmation": "确认点 1 · 确认评审面板",
			"checkpoint.heading.report_approval": "确认点 2 · 批准评审报告",
			"checkpoint.body.field_analysis_attachment": "评审停在 created：领域分析师的结果还没附上。先附上配置卡，再确认面板，两步都由你在会话里发起。",
			"checkpoint.body.panel_confirmation": "领域分析已附上，评审面板还没确认。确认（可编辑配置卡）之后席位才会被派发。",
			"checkpoint.body.report_approval": "草稿决定信已写出，等待你批准。批准前请先在会话里给出每条魔鬼代言人严重发现的裁定。",
			"checkpoint.nextCall": "下一步调用（可复制后交给模型执行）",
			"checkpoint.daRequirement": "裁定要求：Devil’s Advocate 的每条 CRITICAL 发现都要显式裁定，outcome 取 validated / rejected / unresolved；留下 unresolved 时 approve=true 会被拒绝。",
			"checkpoint.copy": "复制调用",
			"checkpoint.copied": "已复制",
			"checkpoint.copyFailed": "复制失败，请手动选择上面的文本",
			"checkpoint.readOnlyNote": "面板只读取状态，从不发起写入。",
			"report.heading": "决定信（Editorial Decision Letter）",
			"report.loading": "正在读取决定信",
			"report.empty": "决定信内容为空。",
			"error.reportLoadFailed": "决定信读取失败：{message}",
			"seat.heading": "评审席位",
			"seat.role": "角色",
			"seat.status": "状态",
			"seat.findings": "发现",
			"seat.editorialSynthesizer": "编辑部综合（synthesis）",
			"seat.id.eic": "主编（Journal-Fit）",
			"seat.id.methodology": "方法论审稿人 1",
			"seat.id.domain": "领域审稿人 2",
			"seat.id.perspective": "视角审稿人 3",
			"seat.id.da": "魔鬼代言人（Devil’s Advocate）",
			"seat.verdict": "结论",
			"severity.critical": "严重",
			"severity.major": "重大",
			"severity.minor": "次要",
			"severity.comment": "评论",
			"status.created": "已创建",
			"status.panel_configured": "面板已配置",
			"status.awaiting_panel_confirmation": "等待面板确认",
			"status.in_review": "评审进行中",
			"status.all_submitted": "全部席位已提交",
			"status.awaiting_synthesis_approval": "等待报告批准",
			"status.report_ready": "报告就绪",
			"status.abandoned": "已放弃",
			"seatStatus.pending": "待派发",
			"seatStatus.dispatched": "已派发",
			"seatStatus.submitted": "已提交",
			"seatStatus.failed": "失败",
			"verdict.accept": "接收",
			"verdict.minor_revision": "小修",
			"verdict.major_revision": "大修",
			"verdict.reject": "拒稿",
			"verdict.none": "—",
			"error.notFound": "未找到该评审。",
			"error.reportNotReady": "报告尚未写出到磁盘（synthesis 未完成或未获批准）。",
			"error.loadFailed": "读取失败：{message}"
		};
		/** English dictionary, key-complete against the Chinese source set. */
		const en = {
			"panel.title": "Academic Review",
			"panel.description": "Status of the five-seat peer-review panel (unofficial DSH port).",
			"panel.emptyTitle": "No review in this workspace yet",
			"panel.emptyBody": "Ask the model to run the academic-paper-reviewer skill in a session; reviews appear here.",
			"panel.loading": "Loading review status",
			"panel.error": "The review service is unavailable. Retrying automatically.",
			"panel.retry": "Reconnect",
			"panel.refresh": "Refresh",
			"review.mode": "Mode",
			"review.status": "Status",
			"review.updated": "Last update",
			"review.checkpoint": "Awaiting your confirmation",
			"review.checkpointHint": "The review is paused at a human checkpoint (panel confirmation or report approval).",
			"review.openReport": "Open report",
			"review.noReport": "Report not written yet",
			"checkpoint.heading.field_analysis_attachment": "Checkpoint 1 · Attach the field analysis",
			"checkpoint.heading.panel_confirmation": "Checkpoint 1 · Confirm the review panel",
			"checkpoint.heading.report_approval": "Checkpoint 2 · Approve the review report",
			"checkpoint.body.field_analysis_attachment": "The review is still at created: the field analyst result is not attached yet. Attach the configuration cards first, then confirm the panel — both steps are yours to start in the session.",
			"checkpoint.body.panel_confirmation": "The field analysis is attached but the panel is not confirmed yet. Confirming (optionally with edited cards) is what allows the seats to be dispatched.",
			"checkpoint.body.report_approval": "The draft decision letter is written and waits for your approval. Before approving, adjudicate every Devil’s Advocate CRITICAL finding in the session.",
			"checkpoint.nextCall": "Next call (copy it and hand it to the model)",
			"checkpoint.daRequirement": "Adjudication requirement: every Devil’s Advocate CRITICAL finding needs an explicit outcome of validated / rejected / unresolved; anything left unresolved makes approve=true refuse.",
			"checkpoint.copy": "Copy call",
			"checkpoint.copied": "Copied",
			"checkpoint.copyFailed": "Copy failed — select the text above manually",
			"checkpoint.readOnlyNote": "The panel only reads state; it never writes.",
			"report.heading": "Editorial decision letter",
			"report.loading": "Loading the decision letter",
			"report.empty": "The decision letter is empty.",
			"error.reportLoadFailed": "Could not load the decision letter: {message}",
			"seat.heading": "Review panel seats",
			"seat.role": "Role",
			"seat.status": "Status",
			"seat.findings": "Findings",
			"seat.editorialSynthesizer": "Editorial synthesizer (synthesis)",
			"seat.id.eic": "Editor-in-Chief (Journal-Fit)",
			"seat.id.methodology": "Peer Reviewer 1 (Methodology)",
			"seat.id.domain": "Peer Reviewer 2 (Domain)",
			"seat.id.perspective": "Peer Reviewer 3 (Perspective)",
			"seat.id.da": "Devil's Advocate",
			"seat.verdict": "Verdict",
			"severity.critical": "Critical",
			"severity.major": "Major",
			"severity.minor": "Minor",
			"severity.comment": "Comment",
			"status.created": "Created",
			"status.panel_configured": "Panel configured",
			"status.awaiting_panel_confirmation": "Awaiting panel confirmation",
			"status.in_review": "In review",
			"status.all_submitted": "All seats submitted",
			"status.awaiting_synthesis_approval": "Awaiting report approval",
			"status.report_ready": "Report ready",
			"status.abandoned": "Abandoned",
			"seatStatus.pending": "Pending",
			"seatStatus.dispatched": "Dispatched",
			"seatStatus.submitted": "Submitted",
			"seatStatus.failed": "Failed",
			"verdict.accept": "Accept",
			"verdict.minor_revision": "Minor revision",
			"verdict.major_revision": "Major revision",
			"verdict.reject": "Reject",
			"verdict.none": "—",
			"error.notFound": "The review was not found.",
			"error.reportNotReady": "The report is not on disk yet (synthesis incomplete or unapproved).",
			"error.loadFailed": "Load failed: {message}"
		};
		//#endregion
		//#region lib/client/index.js
		/** Browser plugin for the Academic Review right-sidebar panel. */
		/** Required services: the browser locale registry and the slot registry. */
		const inject = ["locale", "slots"];
		/** Tab identity: the type id the pane body registers under, and the kind it opens by. */
		const ACADEMIC_REVIEW_TAB_ID = "dsh-academic-review/review-panel";
		const ACADEMIC_REVIEW_TAB_KIND = "academic-review";
		/**
		* Register the dictionaries and the right-sidebar tab that renders the review
		* panel. Discovery of review state happens inside the panel through the
		* plugin's read-only web routes, so registration itself carries no data.
		*/
		function apply(rawCtx) {
			const ctx = rawCtx;
			ctx.effect(() => ctx.locale.register(ACADEMIC_REVIEW_LOCALE_NAMESPACE, {
				zh,
				en
			}), "academic-review: dictionaries");
			ctx.inject(["sidebarRight", "sidebarRightTabs"], (native) => {
				const t = native.locale.bind(ACADEMIC_REVIEW_LOCALE_NAMESPACE);
				native.effect(() => native.sidebarRightTabs?.register({
					id: ACADEMIC_REVIEW_TAB_ID,
					kind: ACADEMIC_REVIEW_TAB_KIND,
					title: () => t("panel.title")
				}));
				native.slots.inject("sidebar.right.pane.tab", () => native.slots.register({
					name: "sidebar.right.pane.tab",
					key: ACADEMIC_REVIEW_TAB_ID,
					locale: ACADEMIC_REVIEW_LOCALE_NAMESPACE
				}, AcademicReviewPanel));
			});
		}
		//#endregion
		exports.ACADEMIC_REVIEW_TAB_ID = ACADEMIC_REVIEW_TAB_ID;
		exports.ACADEMIC_REVIEW_TAB_KIND = ACADEMIC_REVIEW_TAB_KIND;
		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	}
});

//# sourceMappingURL=client.js.map