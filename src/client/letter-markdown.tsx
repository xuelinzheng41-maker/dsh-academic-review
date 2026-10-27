/**
 * Sanitising markdown renderer for the editorial decision letter.
 *
 * The letter is model output. It is parsed with a deliberately small
 * block/inline grammar and turned into React nodes; the client never builds
 * HTML from it, so there is no dangerouslySetInnerHTML anywhere and no
 * injection path: anything the grammar does not recognise (raw tags included)
 * survives as an escaped text node.
 *
 * Supported blocks: ATX headings, paragraphs, bullet/ordered lists (nested by
 * indentation), block quotes, pipe tables, horizontal rules, fenced code.
 * Supported inline: `code`, **bold**, *emphasis*, _emphasis_.
 *
 * @module dsh-academic-review/client
 */

import type { ReactElement, ReactNode } from 'react'

/** One list item with its nested children. */
interface ListItemNode {
  text: string
  children: ListItemNode[]
}

/** One parsed block. */
type Block =
  | { kind: 'heading'; level: number; text: string }
  | { kind: 'paragraph'; text: string }
  | { kind: 'list'; ordered: boolean; items: ListItemNode[] }
  | { kind: 'quote'; text: string }
  | { kind: 'table'; header: string[]; rows: string[][] }
  | { kind: 'rule' }
  | { kind: 'code'; text: string }

/** Inline spans recognised first: code, bold, then star emphasis. */
const INLINE_RE = /(`[^`\n]*`|\*\*[^*\n]+\*\*|\*[^*\n]+\*)/g
/** Word characters: an underscore next to one of these is literal, not emphasis. */
const WORD_CHAR_RE = /[\p{L}\p{N}_]/u

/** Heading line. */
const HEADING_RE = /^ {0,3}(#{1,6})\s+(.*)$/
/** Horizontal rule. */
const RULE_RE = /^ {0,3}(?:-{3,}|\*{3,}|_{3,})\s*$/
/** Block-quote line. */
const QUOTE_RE = /^ {0,3}>\s?(.*)$/
/** List item line, with its indentation depth. */
const LIST_RE = /^(\s*)(?:[-*+]|\d+[.)])\s+(.*)$/
/** Fenced code opener. */
const FENCE_RE = /^ {0,3}(```|~~~)/
/** Table separator cell. */
const TABLE_SEPARATOR_RE = /^:?-{2,}:?$/

/**
 * Split one line into inline React nodes. Every unrecognised span stays a
 * plain string, so React escapes it and markup from the model can never
 * become a live node.
 * @param text - inline markdown.
 * @param keyPrefix - stable key prefix.
 * @returns inline nodes.
 */
function inlineNodes(text: string, keyPrefix: string): ReactNode[] {
  const parts = text.split(INLINE_RE)
  const nodes: ReactNode[] = []
  for (let index = 0; index < parts.length; index += 1) {
    const part = parts[index]
    if (part === undefined || part === '') continue
    const key = keyPrefix + 'i' + String(index)
    if (part.length > 2 && part.startsWith('`') && part.endsWith('`')) {
      nodes.push(<code key={key}>{part.slice(1, -1)}</code>)
    } else if (part.length > 4 && (part.startsWith('**') || part.startsWith('__')) && part.endsWith(part.slice(0, 2))) {
      nodes.push(<strong key={key}>{part.slice(2, -2)}</strong>)
    } else if (part.length > 2 && part.startsWith('*') && part.endsWith('*')) {
      nodes.push(<em key={key}>{part.slice(1, -1)}</em>)
    } else {
      nodes.push(...underscoreEmphasis(part, key + 'u'))
    }
  }
  return nodes
}

/**
 * Emphasise `_text_` spans, but only where the underscores are real
 * delimiters: intraword underscores (minor_revision, snake_case ids) stay
 * literal text, as markdown specifies.
 * @param text - plain fragment.
 * @param keyPrefix - stable key prefix.
 * @returns nodes for that fragment.
 */
function underscoreEmphasis(text: string, keyPrefix: string): ReactNode[] {
  const nodes: ReactNode[] = []
  let emitted = 0
  let scan = 0
  let literalFrom = 0
  while (scan < text.length) {
    const open = text.indexOf('_', scan)
    if (open === -1) break
    const before = open === 0 ? '' : text.charAt(open - 1)
    let close = -1
    if (!WORD_CHAR_RE.test(before)) {
      const candidate = text.indexOf('_', open + 1)
      if (candidate !== -1) {
        const after = candidate + 1 >= text.length ? '' : text.charAt(candidate + 1)
        if (candidate !== open + 1 && !WORD_CHAR_RE.test(after)) close = candidate
      }
    }
    if (close === -1) {
      scan = open + 1
      continue
    }
    if (open > literalFrom) nodes.push(text.slice(literalFrom, open))
    nodes.push(<em key={keyPrefix + 'e' + String(emitted)}>{text.slice(open + 1, close)}</em>)
    emitted += 1
    scan = close + 1
    literalFrom = close + 1
  }
  if (literalFrom < text.length) nodes.push(text.slice(literalFrom))
  return nodes
}

/** Split one table row into trimmed cells (outer pipes dropped). */
function tableCells(line: string): string[] {
  let body = line.trim()
  if (body.startsWith('|')) body = body.slice(1)
  if (body.endsWith('|')) body = body.slice(0, -1)
  return body.split('|').map(cell => cell.trim())
}

/** Whether the line starts a pipe table (row, separator row, ...). */
function isTableStart(lines: readonly string[], index: number): boolean {
  const head = lines[index]
  const divider = lines[index + 1]
  if (head === undefined || divider === undefined) return false
  if (!head.includes('|') || !divider.includes('|')) return false
  const cells = tableCells(divider)
  return cells.length > 0 && cells.every(cell => TABLE_SEPARATOR_RE.test(cell))
}

/** Nest flat (depth, text) rows into a list tree. */
function buildListTree(rows: readonly { depth: number; text: string }[]): ListItemNode[] {
  const root: ListItemNode[] = []
  const stack: { depth: number; items: ListItemNode[] }[] = [{ depth: 0, items: root }]
  for (const row of rows) {
    while (stack.length > 1 && row.depth < (stack[stack.length - 1]?.depth ?? 0)) stack.pop()
    const top = stack[stack.length - 1]
    if (top === undefined) continue
    if (row.depth > top.depth && top.items.length > 0) {
      const parent = top.items[top.items.length - 1]
      if (parent !== undefined) stack.push({ depth: row.depth, items: parent.children })
    }
    const container = stack[stack.length - 1]
    container?.items.push({ text: row.text, children: [] })
  }
  return root
}

/**
 * Parse the letter into blocks.
 * @param markdown - letter text.
 * @returns parsed blocks, in order.
 */
function parseBlocks(markdown: string): Block[] {
  const lines = markdown.replace(/\r\n?/g, '\n').split('\n')
  const blocks: Block[] = []
  let index = 0
  while (index < lines.length) {
    const line = lines[index] ?? ''
    if (line.trim() === '') {
      index += 1
      continue
    }
    const fence = FENCE_RE.exec(line)
    if (fence !== null) {
      const marker = fence[1] ?? '```'
      const body: string[] = []
      index += 1
      while (index < lines.length) {
        const current = lines[index] ?? ''
        if (current.trim().startsWith(marker)) {
          index += 1
          break
        }
        body.push(current)
        index += 1
      }
      blocks.push({ kind: 'code', text: body.join('\n') })
      continue
    }
    const heading = HEADING_RE.exec(line)
    if (heading !== null) {
      blocks.push({ kind: 'heading', level: (heading[1] ?? '#').length, text: (heading[2] ?? '').trim() })
      index += 1
      continue
    }
    if (RULE_RE.test(line)) {
      blocks.push({ kind: 'rule' })
      index += 1
      continue
    }
    if (QUOTE_RE.test(line)) {
      const quoted: string[] = []
      while (index < lines.length) {
        const current = lines[index] ?? ''
        const match = QUOTE_RE.exec(current)
        if (match === null) break
        quoted.push((match[1] ?? '').trim())
        index += 1
      }
      blocks.push({ kind: 'quote', text: quoted.join(' ').trim() })
      continue
    }
    if (isTableStart(lines, index)) {
      const header = tableCells(line)
      index += 2
      const rows: string[][] = []
      while (index < lines.length) {
        const current = lines[index] ?? ''
        if (current.trim() === '' || !current.includes('|')) break
        rows.push(tableCells(current))
        index += 1
      }
      blocks.push({ kind: 'table', header, rows })
      continue
    }
    const listMatch = LIST_RE.exec(line)
    if (listMatch !== null) {
      const ordered = /^\d/.test(line.trim())
      const rows: { depth: number; text: string }[] = []
      while (index < lines.length) {
        const current = lines[index] ?? ''
        const match = LIST_RE.exec(current)
        if (match === null) break
        rows.push({
          depth: Math.floor((match[1] ?? '').replace(/\t/g, '  ').length / 2),
          text: (match[2] ?? '').trim(),
        })
        index += 1
      }
      blocks.push({ kind: 'list', ordered, items: buildListTree(rows) })
      continue
    }
    // Paragraph: consecutive non-blank lines that do not start another block.
    const paragraph: string[] = []
    while (index < lines.length) {
      const current = lines[index] ?? ''
      if (current.trim() === '') break
      if (paragraph.length > 0
        && (HEADING_RE.test(current) || RULE_RE.test(current) || QUOTE_RE.test(current)
          || LIST_RE.test(current) || isTableStart(lines, index) || FENCE_RE.test(current))) {
        break
      }
      paragraph.push(current.trim())
      index += 1
    }
    blocks.push({ kind: 'paragraph', text: paragraph.join(' ') })
  }
  return blocks
}

/** Render a nested list body. */
function renderListItems(items: readonly ListItemNode[], keyPrefix: string): ReactElement[] {
  return items.map((item, index) => {
    const key = keyPrefix + 'l' + String(index)
    return (
      <li key={key}>
        {inlineNodes(item.text, key + '-')}
        {item.children.length > 0 ? <ul>{renderListItems(item.children, key + '-')}</ul> : null}
      </li>
    )
  })
}

/** Render one parsed block. */
function renderBlock(block: Block, key: string): ReactElement {
  switch (block.kind) {
    case 'heading': {
      const inline = inlineNodes(block.text, key + '-')
      switch (block.level) {
        case 1: return <h1 key={key}>{inline}</h1>
        case 2: return <h2 key={key}>{inline}</h2>
        case 3: return <h3 key={key}>{inline}</h3>
        case 4: return <h4 key={key}>{inline}</h4>
        case 5: return <h5 key={key}>{inline}</h5>
        default: return <h6 key={key}>{inline}</h6>
      }
    }
    case 'paragraph':
      return <p key={key}>{inlineNodes(block.text, key + '-')}</p>
    case 'list': {
      const body = renderListItems(block.items, key + '-')
      return block.ordered ? <ol key={key}>{body}</ol> : <ul key={key}>{body}</ul>
    }
    case 'quote':
      return <blockquote key={key}>{inlineNodes(block.text, key + '-')}</blockquote>
    case 'table':
      return (
        <table key={key}>
          <thead>
            <tr>
              {block.header.map((cell, index) => (
                <th key={key + '-h' + String(index)}>{inlineNodes(cell, key + '-h' + String(index) + '-')}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {block.rows.map((row, rowIndex) => (
              <tr key={key + '-r' + String(rowIndex)}>
                {row.map((cell, cellIndex) => (
                  <td key={key + '-r' + String(rowIndex) + 'c' + String(cellIndex)}>
                    {inlineNodes(cell, key + '-r' + String(rowIndex) + 'c' + String(cellIndex) + '-')}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      )
    case 'rule':
      return <hr key={key} />
    case 'code':
      return <pre key={key}><code>{block.text}</code></pre>
  }
}

/**
 * Render letter markdown as React nodes (never as HTML).
 * @param markdown - editorial decision letter.
 * @returns one element per parsed block.
 */
export function renderLetter(markdown: string): ReactElement[] {
  return parseBlocks(markdown).map((block, index) => renderBlock(block, 'b' + String(index)))
}
