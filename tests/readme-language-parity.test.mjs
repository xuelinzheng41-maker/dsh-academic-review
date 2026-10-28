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
 * LINE ENDINGS. Every line-based assertion runs on text normalised to LF. This
 * is not tidiness: GitHub's Windows runners check out with core.autocrlf=true,
 * so both READMEs arrive with CRLF and a raw split('\n') leaves a trailing
 * '\r' on every line - which is exactly how the first version of this test
 * passed on Linux and failed on Windows (run 40477120319, both windows rows).
 * Nothing here rewrites the files on disk; normalisation happens in memory, on
 * both sides of every comparison, so a real content difference still fails.
 *
 * Deliberately NOT asserted: equal line counts, or equal prose length per
 * section. Chinese wraps differently and the same content occupies fewer
 * lines, so a line-count comparison would fail a perfectly good translation.
 * The structural checks here are the ones that catch real drift.
 *
 * The legal tokens test is legal, not cosmetic: the attribution block and the
 * license disclaimer are load-bearing under CC BY-NC 4.0, so the English proper
 * nouns and the \"unofficial DSH port\" wording must survive translation.
 */
import assert from 'node:assert/strict'
import { access, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

/**
 * Repository root. The env override exists only so this file can be exercised
 * against a converted copy of the documentation (CRLF proof run); it defaults
 * to the real repository.
 */
const repoRoot = (() => {
  const override = process.env.DSH_README_PARITY_ROOT
  return override !== undefined && override.trim() !== ''
    ? resolve(override)
    : fileURLToPath(new URL('..', import.meta.url))
})()

const ENGLISH = 'README.md'
const CHINESE = 'README.zh-CN.md'

/** Expected first line of each file: current language bold, the other linked. */
const SWITCHER = new Map([
  [ENGLISH, '**English** | [简体中文](README.zh-CN.md)'],
  [CHINESE, '[English](README.md) | **简体中文**'],
])

/**
 * Convert any line-ending convention to LF and drop a leading BOM.
 * Every line-based comparison in this file goes through here, once per side.
 * @param text - raw file content, whatever the checkout produced.
 * @returns the same content with only '\n' as a line separator.
 */
function normaliseEol(text) {
  return text.replace(/^\uFEFF/u, '').replace(/\r\n/gu, '\n').replace(/\r/gu, '\n')
}

/** Raw content of a README, untouched (for line-ending inspection). */
async function readRaw(name) {
  return readFile(join(repoRoot, name), 'utf8')
}

/** Content of a README, normalised to LF (for every line-based assertion). */
async function readDoc(name) {
  return normaliseEol(await readRaw(name))
}

/**
 * Classify the line endings of raw file content.
 * @param raw - file content as read from disk.
 * @returns 'crlf', 'lf', 'mixed', or 'none' when the file has no line break.
 */
function eolStyle(raw) {
  const crlf = (raw.match(/\r\n/gu) ?? []).length
  const loneCr = (raw.match(/\r(?!\n)/gu) ?? []).length
  const lf = (raw.match(/(?<!\r)\n/gu) ?? []).length
  if (crlf + loneCr + lf === 0) return 'none'
  if (loneCr > 0 || (crlf > 0 && lf > 0)) return 'mixed'
  return crlf > 0 ? 'crlf' : 'lf'
}

/** Every fenced code block, with its info string and body. Expects LF text. */
function fencedBlocks(text) {
  return [...text.matchAll(/^```([^\n]*)\n([\s\S]*?)^```$/gm)].map(match => ({
    info: match[1],
    body: match[2],
  }))
}

/**
 * Split a document into its heading sequence and one bucket per heading.
 * @param text - markdown source, already normalised to LF.
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

/** Heading slugs of one document, in order. */
function headingSlugs(text) {
  return [...text.matchAll(/^#{1,6}\s+(.*)$/gmu)].map(match => slug(match[1].trim()))
}

/** Intra-document anchors used by a document. */
function anchors(text) {
  return [...new Set([...text.matchAll(/\]\(#([^)]+)\)/gu)].map(match => match[1]))]
}

/**
 * Assert the language switcher contract on one file's *normalised* text.
 * Extracted so the CRLF fixture test runs the very same assertions.
 * @param name - file name the text came from.
 * @param text - LF-normalised content.
 */
function assertSwitcher(name, text) {
  const lines = text.split('\n')
  assert.equal(lines[0], SWITCHER.get(name), name + ' must start with its language switcher')
  assert.equal(lines[1], '', name + ' needs a blank line between switcher and H1')
  assert.equal(lines[2], '# dsh-academic-skills', name + ' H1 must stay the project name')
}

test('both README files exist and open with their language switcher', async () => {
  for (const name of SWITCHER.keys()) {
    await access(join(repoRoot, name))
    const text = await readDoc(name)
    assert.ok(text.trim().length > 1000, name + ' looks empty')
    assertSwitcher(name, text)
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
  // Both sides are normalised before comparing: on a Windows checkout BOTH
  // files arrive CRLF, so a raw comparison would fail on line endings alone.
  // Normalising both sides keeps the check about translated code, while a
  // genuine CRLF-vs-LF divergence between the two files is caught separately by
  // the 'agree on their line endings on disk' test below.
  const english = fencedBlocks(await readDoc(ENGLISH))
  const chinese = fencedBlocks(await readDoc(CHINESE))
  assert.ok(english.length > 0, 'expected fenced blocks in README.md')
  assert.equal(chinese.length, english.length, 'fenced block count differs')
  for (let index = 0; index < english.length; index += 1) {
    assert.equal(chinese[index].info, english[index].info, 'fence info string differs at block ' + index)
    assert.equal(chinese[index].body, english[index].body, 'code inside block ' + index + ' was translated')
  }
})

test('the two READMEs agree on their line endings on disk', async () => {
  // core.autocrlf makes a WORKING COPY CRLF for both files, which is fine and
  // is why the content checks normalise. What is not fine is the two files
  // disagreeing with each other, or one file mixing conventions: that is a real
  // divergence (it survives clone on any platform) and it must not be masked by
  // the normalisation the other checks rely on.
  const english = eolStyle(await readRaw(ENGLISH))
  const chinese = eolStyle(await readRaw(CHINESE))
  assert.notEqual(english, 'mixed', ENGLISH + ' mixes CRLF and LF')
  assert.notEqual(chinese, 'mixed', CHINESE + ' mixes CRLF and LF')
  assert.equal(chinese, english, 'the two READMEs use different line endings: ' + english + ' vs ' + chinese)
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
    const headings = headingSlugs(text)
    const used = anchors(text)
    assert.ok(used.length > 0, name + ' should link to at least one section of itself')
    for (const anchor of used) {
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

test('a CRLF checkout passes every line-based check (regression)', async () => {
  // Regression for run 40477120319: Windows runners check these files out with
  // CRLF and the un-normalised test failed there while passing on Linux. The
  // fixtures are the real documents with every LF rewritten to CRLF, so this
  // case fails on any platform if the normalisation is dropped again.
  const directory = await mkdtemp(join(tmpdir(), 'dsh-readme-parity-'))
  try {
    const raw = new Map()
    for (const name of SWITCHER.keys()) raw.set(name, await readRaw(name))
    for (const [name, text] of raw) {
      const crlf = normaliseEol(text).replace(/\n/gu, '\r\n')
      await writeFile(join(directory, name), crlf, 'utf8')
    }
    // Prove the fixture really is CRLF, or the regression would prove nothing.
    for (const name of SWITCHER.keys()) {
      assert.equal(eolStyle(await readFile(join(directory, name), 'utf8')), 'crlf', name + ' fixture is not CRLF')
    }
    const e = normaliseEol(await readFile(join(directory, ENGLISH), 'utf8'))
    const c = normaliseEol(await readFile(join(directory, CHINESE), 'utf8'))
    assertSwitcher(ENGLISH, e)
    assertSwitcher(CHINESE, c)
    assert.equal((e.split('\n')[0]).includes('\r'), false, 'normalisation left a CR behind')
    const english = structure(e)
    const chinese = structure(c)
    assert.equal(chinese.headings.length, english.headings.length)
    assert.deepEqual(
      chinese.sections.map(section => section.tableRows),
      english.sections.map(section => section.tableRows),
    )
    assert.deepEqual(fencedBlocks(c), fencedBlocks(e))
    for (const anchor of anchors(c)) assert.ok(headingSlugs(c).includes(anchor))
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test('an actually-wrong switcher line is still rejected (negative control)', async () => {
  // The normalisation must not turn the check into a rubber stamp.
  const good = await readDoc(ENGLISH)
  const lines = good.split('\n')
  const wrongFirstLine = ['# dsh-academic-skills', ...lines.slice(1)].join('\n')
  assert.throws(() => assertSwitcher(ENGLISH, wrongFirstLine), /language switcher/u)
  const swapped = [SWITCHER.get(CHINESE), ...lines.slice(1)].join('\n')
  assert.throws(() => assertSwitcher(ENGLISH, swapped), /language switcher/u)
  // And a CRLF fixture with the wrong switcher fails for the right reason.
  const crlfWrong = wrongFirstLine.replace(/\n/gu, '\r\n')
  assert.throws(() => assertSwitcher(ENGLISH, normaliseEol(crlfWrong)), /language switcher/u)
})
