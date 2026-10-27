/**
 * Bilingual README parity tests.
 *
 * README.md and README.zh-CN.md are the same document in two languages. These
 * checks make that machine-checkable so the Chinese page cannot rot into a
 * stale translation: the language switcher must work, the fenced code blocks
 * must be identical (code is never translated), the heading skeleton and the
 * table shape must match section by section, and neither file may carry a
 * dangling relative link or intra-document anchor.
 *
 * Deliberately NOT asserted: equal line counts, or equal prose length per
 * section. Chinese wraps differently and the same content occupies fewer
 * lines, so a line-count comparison would fail a perfectly good translation.
 * The structural checks here are the ones that catch real drift.
 *
 * The last test is legal, not cosmetic: the attribution block and the license
 * disclaimer are load-bearing under CC BY-NC 4.0, so the English proper nouns
 * and the "unofficial DSH port" wording must survive translation verbatim.
 */
import assert from 'node:assert/strict'
import { access, readFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

const repoRoot = fileURLToPath(new URL('..', import.meta.url))
const ENGLISH = 'README.md'
const CHINESE = 'README.zh-CN.md'

/** Expected first line of each file: current language bold, the other linked. */
const SWITCHER = new Map([
  [ENGLISH, '**English** | [简体中文](README.zh-CN.md)'],
  [CHINESE, '[English](README.md) | **简体中文**'],
])

/** Read one README from the repository root. */
async function readDoc(name) {
  return readFile(join(repoRoot, name), 'utf8')
}

/** Every fenced code block, with its info string and body. */
function fencedBlocks(text) {
  return [...text.matchAll(/^```([^\n]*)\n([\s\S]*?)^```$/gm)].map(match => ({
    info: match[1],
    body: match[2],
  }))
}

/**
 * Split a document into its heading sequence and one bucket per heading.
 * @param text - markdown source.
 * @returns heading levels in order, plus per-heading table-row and line counts.
 */
function structure(text) {
  const headings = []
  const sections = []
  let current = { title: null, tableRows: 0, lines: 0 }
  for (const line of text.split('\n')) {
    const heading = /^(#{1,6})\s+(.*)$/u.exec(line)
    if (heading !== null) {
      sections.push(current)
      headings.push({ level: heading[1].length, title: heading[2].trim() })
      current = { title: heading[2].trim(), tableRows: 0, lines: 0 }
      continue
    }
    current.lines += 1
    if (line.trim().startsWith('|')) current.tableRows += 1
  }
  sections.push(current)
  return { headings, sections }
}

/** Markdown links whose target is a path in this repository. */
function relativeLinks(text) {
  const targets = []
  for (const match of text.matchAll(/\[[^\]]*\]\(([^)\s]+)\)/gu)) {
    const target = match[1]
    if (/^(?:https?:|mailto:|#)/u.test(target)) continue
    const path = target.split('#')[0]
    if (path !== '') targets.push(target)
  }
  return targets
}

/** GitHub-style heading slug, close enough to resolve our own anchors. */
function slug(heading) {
  return heading.toLowerCase()
    .replace(/[`*_~]/gu, '')
    .replace(/[^\p{L}\p{N}\s-]/gu, '')
    .trim()
    .replace(/\s/gu, '-')
}

/** Intra-document anchors used by a document. */
function anchors(text) {
  return [...new Set([...text.matchAll(/\]\(#([^)]+)\)/gu)].map(match => match[1]))]
}

test('both README files exist and open with their language switcher', async () => {
  for (const [name, switcher] of SWITCHER) {
    await access(join(repoRoot, name))
    const text = await readDoc(name)
    assert.ok(text.trim().length > 1000, name + ' looks empty')
    const lines = text.split('\n')
    assert.equal(lines[0], switcher, name + ' must start with its language switcher')
    assert.ok(lines[1] === '', name + ' needs a blank line between switcher and H1')
    assert.equal(lines[2], '# dsh-academic-review', name + ' H1 must stay the project name')
  }
})

test('each file carries exactly one switcher line and it links to a file that exists', async () => {
  for (const name of SWITCHER.keys()) {
    const text = await readDoc(name)
    const switcherLines = text.split('\n').filter(line =>
      line.includes('简体中文') && /\[English\]\(README\.md\)|\*\*English\*\*/u.test(line))
    assert.equal(switcherLines.length, 1, name + ' must carry exactly one switcher line')
    const targets = relativeLinks(switcherLines[0])
    assert.equal(targets.length, 1, name + ' switcher must link to the other README exactly once')
    await access(resolve(dirname(join(repoRoot, name)), targets[0].split('#')[0]))
    // The current language is bold and unlinked, so neither side links to itself.
    assert.equal(targets.includes(name), false, name + ' must not link to itself')
  }
})

test('fenced code blocks are identical in count and content', async () => {
  const english = fencedBlocks(await readDoc(ENGLISH))
  const chinese = fencedBlocks(await readDoc(CHINESE))
  assert.ok(english.length > 0, 'expected fenced blocks in README.md')
  assert.equal(chinese.length, english.length, 'fenced block count differs')
  for (let index = 0; index < english.length; index += 1) {
    assert.equal(chinese[index].info, english[index].info, 'fence info string differs at block ' + index)
    assert.equal(chinese[index].body, english[index].body, 'code inside block ' + index + ' was translated')
  }
})

test('the Chinese code blocks contain no translated text', async () => {
  const chinese = fencedBlocks(await readDoc(CHINESE))
  const cjk = /[\u3400-\u4dbf\u4e00-\u9fff\u3040-\u30ff]/u
  for (const [index, block] of chinese.entries()) {
    assert.equal(cjk.test(block.body), false, 'block ' + index + ' contains CJK characters')
  }
})

test('headings and table rows match section by section', async () => {
  const english = structure(await readDoc(ENGLISH))
  const chinese = structure(await readDoc(CHINESE))
  assert.equal(chinese.headings.length, english.headings.length, 'heading count differs')
  const englishLevels = english.headings.map(heading => heading.level)
  const chineseLevels = chinese.headings.map(heading => heading.level)
  assert.deepEqual(chineseLevels, englishLevels, 'heading level sequence differs')
  const englishRows = english.sections.map(section => section.tableRows)
  const chineseRows = chinese.sections.map(section => section.tableRows)
  assert.deepEqual(chineseRows, englishRows, 'table row counts differ per section')
  const englishTables = englishRows.reduce((sum, rows) => sum + rows, 0)
  const chineseTables = chineseRows.reduce((sum, rows) => sum + rows, 0)
  assert.equal(chineseTables, englishTables)
  assert.ok(englishTables > 0, 'expected tables in README.md')
})

test('every relative link in both files resolves on disk', async () => {
  for (const name of SWITCHER.keys()) {
    const text = await readDoc(name)
    const base = dirname(join(repoRoot, name))
    const targets = relativeLinks(text)
    assert.ok(targets.length > 5, name + ' should carry the documentation links')
    for (const target of targets) {
      await access(resolve(base, target.split('#')[0]))
    }
  }
})

test('every intra-document anchor resolves to a heading in the same file', async () => {
  for (const name of SWITCHER.keys()) {
    const text = await readDoc(name)
    const headings = [...text.matchAll(/^#{1,6}\s+(.*)$/gmu)].map(match => slug(match[1].trim()))
    for (const anchor of anchors(text)) {
      assert.ok(headings.includes(anchor), name + ' has no heading for #' + anchor)
    }
  }
})

test('the Chinese file keeps the legally load-bearing English tokens', async () => {
  const chinese = await readDoc(CHINESE)
  const required = [
    'unofficial DSH port',
    'Cheng-I Wu',
    'https://orcid.org/0009-0008-9523-0103',
    'https://github.com/Imbad0202/academic-research-skills',
    '1.11.1',
    '1ec249df',
    'CC BY-NC 4.0',
    'NOASSERTION',
  ]
  for (const token of required) assert.ok(chinese.includes(token), 'missing from README.zh-CN.md: ' + token)
  // Non-commercial and the non-relicensing clause must be stated in Chinese too.
  assert.ok(chinese.includes('非商业'), 'the Chinese file must say 非商业 (non-commercial)')
  assert.ok(chinese.includes('Apache-2.0'), 'the no-relicensing clause must survive translation')
})
