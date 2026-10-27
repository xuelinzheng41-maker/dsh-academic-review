import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
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
        if (part === undefined || part === '')
            continue;
        const key = keyPrefix + 'i' + String(index);
        if (part.length > 2 && part.startsWith('`') && part.endsWith('`')) {
            nodes.push(_jsx("code", { children: part.slice(1, -1) }, key));
        }
        else if (part.length > 4 && (part.startsWith('**') || part.startsWith('__')) && part.endsWith(part.slice(0, 2))) {
            nodes.push(_jsx("strong", { children: part.slice(2, -2) }, key));
        }
        else if (part.length > 2 && part.startsWith('*') && part.endsWith('*')) {
            nodes.push(_jsx("em", { children: part.slice(1, -1) }, key));
        }
        else {
            nodes.push(...underscoreEmphasis(part, key + 'u'));
        }
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
        const open = text.indexOf('_', scan);
        if (open === -1)
            break;
        const before = open === 0 ? '' : text.charAt(open - 1);
        let close = -1;
        if (!WORD_CHAR_RE.test(before)) {
            const candidate = text.indexOf('_', open + 1);
            if (candidate !== -1) {
                const after = candidate + 1 >= text.length ? '' : text.charAt(candidate + 1);
                if (candidate !== open + 1 && !WORD_CHAR_RE.test(after))
                    close = candidate;
            }
        }
        if (close === -1) {
            scan = open + 1;
            continue;
        }
        if (open > literalFrom)
            nodes.push(text.slice(literalFrom, open));
        nodes.push(_jsx("em", { children: text.slice(open + 1, close) }, keyPrefix + 'e' + String(emitted)));
        emitted += 1;
        scan = close + 1;
        literalFrom = close + 1;
    }
    if (literalFrom < text.length)
        nodes.push(text.slice(literalFrom));
    return nodes;
}
/** Split one table row into trimmed cells (outer pipes dropped). */
function tableCells(line) {
    let body = line.trim();
    if (body.startsWith('|'))
        body = body.slice(1);
    if (body.endsWith('|'))
        body = body.slice(0, -1);
    return body.split('|').map(cell => cell.trim());
}
/** Whether the line starts a pipe table (row, separator row, ...). */
function isTableStart(lines, index) {
    const head = lines[index];
    const divider = lines[index + 1];
    if (head === undefined || divider === undefined)
        return false;
    if (!head.includes('|') || !divider.includes('|'))
        return false;
    const cells = tableCells(divider);
    return cells.length > 0 && cells.every(cell => TABLE_SEPARATOR_RE.test(cell));
}
/** Nest flat (depth, text) rows into a list tree. */
function buildListTree(rows) {
    const root = [];
    const stack = [{ depth: 0, items: root }];
    for (const row of rows) {
        while (stack.length > 1 && row.depth < (stack[stack.length - 1]?.depth ?? 0))
            stack.pop();
        const top = stack[stack.length - 1];
        if (top === undefined)
            continue;
        if (row.depth > top.depth && top.items.length > 0) {
            const parent = top.items[top.items.length - 1];
            if (parent !== undefined)
                stack.push({ depth: row.depth, items: parent.children });
        }
        const container = stack[stack.length - 1];
        container?.items.push({ text: row.text, children: [] });
    }
    return root;
}
/**
 * Parse the letter into blocks.
 * @param markdown - letter text.
 * @returns parsed blocks, in order.
 */
function parseBlocks(markdown) {
    const lines = markdown.replace(/\r\n?/g, '\n').split('\n');
    const blocks = [];
    let index = 0;
    while (index < lines.length) {
        const line = lines[index] ?? '';
        if (line.trim() === '') {
            index += 1;
            continue;
        }
        const fence = FENCE_RE.exec(line);
        if (fence !== null) {
            const marker = fence[1] ?? '```';
            const body = [];
            index += 1;
            while (index < lines.length) {
                const current = lines[index] ?? '';
                if (current.trim().startsWith(marker)) {
                    index += 1;
                    break;
                }
                body.push(current);
                index += 1;
            }
            blocks.push({ kind: 'code', text: body.join('\n') });
            continue;
        }
        const heading = HEADING_RE.exec(line);
        if (heading !== null) {
            blocks.push({ kind: 'heading', level: (heading[1] ?? '#').length, text: (heading[2] ?? '').trim() });
            index += 1;
            continue;
        }
        if (RULE_RE.test(line)) {
            blocks.push({ kind: 'rule' });
            index += 1;
            continue;
        }
        if (QUOTE_RE.test(line)) {
            const quoted = [];
            while (index < lines.length) {
                const current = lines[index] ?? '';
                const match = QUOTE_RE.exec(current);
                if (match === null)
                    break;
                quoted.push((match[1] ?? '').trim());
                index += 1;
            }
            blocks.push({ kind: 'quote', text: quoted.join(' ').trim() });
            continue;
        }
        if (isTableStart(lines, index)) {
            const header = tableCells(line);
            index += 2;
            const rows = [];
            while (index < lines.length) {
                const current = lines[index] ?? '';
                if (current.trim() === '' || !current.includes('|'))
                    break;
                rows.push(tableCells(current));
                index += 1;
            }
            blocks.push({ kind: 'table', header, rows });
            continue;
        }
        const listMatch = LIST_RE.exec(line);
        if (listMatch !== null) {
            const ordered = /^\d/.test(line.trim());
            const rows = [];
            while (index < lines.length) {
                const current = lines[index] ?? '';
                const match = LIST_RE.exec(current);
                if (match === null)
                    break;
                rows.push({
                    depth: Math.floor((match[1] ?? '').replace(/\t/g, '  ').length / 2),
                    text: (match[2] ?? '').trim(),
                });
                index += 1;
            }
            blocks.push({ kind: 'list', ordered, items: buildListTree(rows) });
            continue;
        }
        // Paragraph: consecutive non-blank lines that do not start another block.
        const paragraph = [];
        while (index < lines.length) {
            const current = lines[index] ?? '';
            if (current.trim() === '')
                break;
            if (paragraph.length > 0
                && (HEADING_RE.test(current) || RULE_RE.test(current) || QUOTE_RE.test(current)
                    || LIST_RE.test(current) || isTableStart(lines, index) || FENCE_RE.test(current))) {
                break;
            }
            paragraph.push(current.trim());
            index += 1;
        }
        blocks.push({ kind: 'paragraph', text: paragraph.join(' ') });
    }
    return blocks;
}
/** Render a nested list body. */
function renderListItems(items, keyPrefix) {
    return items.map((item, index) => {
        const key = keyPrefix + 'l' + String(index);
        return (_jsxs("li", { children: [inlineNodes(item.text, key + '-'), item.children.length > 0 ? _jsx("ul", { children: renderListItems(item.children, key + '-') }) : null] }, key));
    });
}
/** Render one parsed block. */
function renderBlock(block, key) {
    switch (block.kind) {
        case 'heading': {
            const inline = inlineNodes(block.text, key + '-');
            switch (block.level) {
                case 1: return _jsx("h1", { children: inline }, key);
                case 2: return _jsx("h2", { children: inline }, key);
                case 3: return _jsx("h3", { children: inline }, key);
                case 4: return _jsx("h4", { children: inline }, key);
                case 5: return _jsx("h5", { children: inline }, key);
                default: return _jsx("h6", { children: inline }, key);
            }
        }
        case 'paragraph':
            return _jsx("p", { children: inlineNodes(block.text, key + '-') }, key);
        case 'list': {
            const body = renderListItems(block.items, key + '-');
            return block.ordered ? _jsx("ol", { children: body }, key) : _jsx("ul", { children: body }, key);
        }
        case 'quote':
            return _jsx("blockquote", { children: inlineNodes(block.text, key + '-') }, key);
        case 'table':
            return (_jsxs("table", { children: [_jsx("thead", { children: _jsx("tr", { children: block.header.map((cell, index) => (_jsx("th", { children: inlineNodes(cell, key + '-h' + String(index) + '-') }, key + '-h' + String(index)))) }) }), _jsx("tbody", { children: block.rows.map((row, rowIndex) => (_jsx("tr", { children: row.map((cell, cellIndex) => (_jsx("td", { children: inlineNodes(cell, key + '-r' + String(rowIndex) + 'c' + String(cellIndex) + '-') }, key + '-r' + String(rowIndex) + 'c' + String(cellIndex)))) }, key + '-r' + String(rowIndex)))) })] }, key));
        case 'rule':
            return _jsx("hr", {}, key);
        case 'code':
            return _jsx("pre", { children: _jsx("code", { children: block.text }) }, key);
    }
}
/**
 * Render letter markdown as React nodes (never as HTML).
 * @param markdown - editorial decision letter.
 * @returns one element per parsed block.
 */
export function renderLetter(markdown) {
    return parseBlocks(markdown).map((block, index) => renderBlock(block, 'b' + String(index)));
}
