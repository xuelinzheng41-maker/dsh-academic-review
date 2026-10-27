/**
 * Reference-integrity and served-payload acceptance tests for the vendored
 * skills (P3-1 / P3-2).
 *
 * A vendored skill whose internal references dangle is worse than no skill: the
 * agent is told to read a path that does not exist and improvises instead. So
 * every markdown file under vendor/ is walked - all three skill trees and the
 * shared/ tree they send the agent into - and every relative link and bare
 * shared/... path is resolved against the vendored tree on disk.
 *
 * What counts as a reference:
 * - markdown links [text](target) whose target is not http(s)/mailto/#anchor,
 *   EXCEPT a link written inside a code span or a fenced block: `[text](url)`
 *   in a LaTeX-conversion table is an example, not a path (the rule the vendoring
 *   scanner applies, commit 3b27680);
 * - bare shared/... paths wherever they appear - including inside code spans,
 *   because those are real pointers the agent is told to open.
 * Template placeholders (shared/contracts/<domain>/<mode>.json), brace/star/$
 * patterns and a bare "shared/" are not references and are counted separately.
 *
 * Two kinds of target are distinguished:
 * - IN PORT: the target lives under a directory this port vendors. It must
 *   exist; a miss is a real defect and fails the test.
 * - OUT OF PORT: the target starts with an upstream area that is not vendored
 *   here. These are recorded in UNVENDORED_UPSTREAM_AREAS with the reason, MUST
 *   NOT be patched by editing vendored text, and are reported instead. The
 *   assertion is two-sided: no unseen area may appear, and no listed area may
 *   become unused.
 *
 * The second half of the file guards what the provider actually ships: the ORDER
 * of the served academic-paper payload (write-policy block, then the vendored
 * body, then the appended port notice), the byte counts of all three served
 * bodies - the reviewer's are the canary and must never move - and the one
 * non-markdown vendored file, whose pin has to be tested, not assumed.
 *
 * @module dsh-academic-review/tests/skill-references
 */

import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readdir, readFile, stat } from 'node:fs/promises'
import { join, posix } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import { Context } from '@deepseek-ai/cordis'
import { SkillRegistry } from '@deepseek-ai/dsh-skill'
import {
  DEEP_RESEARCH_SKILL_NAME,
  PORT_NOTICE_BEGIN,
  PORT_NOTICE_END,
  REVIEW_SKILL_NAME,
  defaultVendorBasePath,
  parseSkillDocument,
  registerReviewSkillProvider,
} from '../lib/skills.js'
import { WRITE_POLICY_BEGIN, WRITE_POLICY_END, renderWritePolicyBlock } from '../lib/write-policy.js'

const repoRoot = fileURLToPath(new URL('..', import.meta.url))
const vendorRoot = defaultVendorBasePath()
const vendorDir = join(repoRoot, 'vendor')

/** The third vendored skill: the one that instructs the model to write files. */
const PAPER_SKILL_NAME = 'academic-paper'

/** The fourth vendored skill: the first one that ships executable payload. */
const SCREENER_SKILL_NAME = 'sr-screener'

/**
 * The served catalog, pinned by hand. vendor-integrity.test.mjs pins the same
 * set against the manifest; this file pins it against the provider, because a
 * test that merely iterates whatever happens to be vendored proves less than one
 * that states what it expects to find.
 */
const EXPECTED_SERVED_SKILLS = ['academic-paper', REVIEW_SKILL_NAME, DEEP_RESEARCH_SKILL_NAME, SCREENER_SKILL_NAME]

/**
 * Upstream areas a vendored file may name without the target being vendored
 * here, with the reason each one is out of port. These are REPORTED, never fixed
 * by editing vendored text or by adding files: the port vendors exactly the
 * skills the plugin serves plus their shared/ closure.
 */
const UNVENDORED_UPSTREAM_AREAS = new Map([
  ['academic-pipeline', 'upstream skill academic-pipeline: not vendored by this port (only paper, reviewer and deep-research are served)'],
  ['docs', 'upstream repository docs/design specs: not vendored by this port'],
  ['examples', 'upstream repository examples/: not vendored by this port'],
  ['scripts', 'upstream repository scripts/: not vendored by this port'],
])

/** Markdown link with an inline destination and optional title. */
const MARKDOWN_LINK = /\[[^\]]*\]\(([^)\s]+)(?:\s+"[^"]*")?\)/gu
/** Bare shared/... path, not part of a longer path or URL. */
const BARE_SHARED_PATH = /(?<![A-Za-z0-9_./-])shared\/[A-Za-z0-9_./<>{}*$-]+/gu
/** Angle brackets, braces, stars and $ mark a template placeholder, not a path. */
const PLACEHOLDER = /[<>{}*$]/u

/** Every file under a directory, as posix paths relative to it. */
async function walkFiles(dir, prefix = '') {
  const out = []
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const relative = prefix === '' ? entry.name : prefix + '/' + entry.name
    if (entry.isDirectory()) out.push(...(await walkFiles(join(dir, entry.name), relative)))
    else out.push(relative)
  }
  return out
}

/** Whether a vendored relative path exists as a file or a directory. */
async function existsInsideVendor(relative) {
  try {
    await stat(join(vendorDir, relative))
    return true
  } catch {
    return false
  }
}

/**
 * Blank out fenced blocks and inline code spans, keeping offsets intact.
 * Backtick runs are paired by length, so a fence opened with three backticks
 * closes only on three, and an inline span opened with one closes only on one.
 */
function maskCode(text) {
  const chars = [...text]
  let index = 0
  while (index < chars.length) {
    if (chars[index] !== '`') {
      index += 1
      continue
    }
    let run = 0
    while (chars[index + run] === '`') run += 1
    let cursor = index + run
    let closer = -1
    while (cursor < chars.length) {
      if (chars[cursor] === '`') {
        let closingRun = 0
        while (chars[cursor + closingRun] === '`') closingRun += 1
        if (closingRun === run) {
          closer = cursor
          break
        }
        cursor += closingRun
        continue
      }
      cursor += 1
    }
    if (closer === -1) {
      index += run
      continue
    }
    for (let position = index; position < closer + run; position += 1) {
      if (chars[position] !== '\n') chars[position] = ' '
    }
    index = closer + run
  }
  return chars.join('')
}

/** Strip a trailing sentence period and any #anchor from a raw reference. */
function normalizeReference(raw) {
  return raw.split('#')[0].replace(/[.,;:!?]+$/u, '').replace(/^</u, '').replace(/>$/u, '')
}

/** Resolve one reference to a vendor-relative path. */
function resolveReference(file, raw, kind) {
  if (kind === 'shared') return posix.normalize(raw)
  const directory = posix.dirname(file)
  return posix.normalize(posix.join(directory === '.' ? '' : directory, raw))
}

/**
 * Every reference found in one markdown file, in file order.
 * Links are read from the code-masked text (an example is not a reference);
 * bare shared/ paths are read from the raw text (a code span is a real pointer).
 */
function referencesIn(file, text) {
  const found = []
  for (const match of maskCode(text).matchAll(MARKDOWN_LINK)) {
    const raw = match[1]
    if (/^(?:https?:|mailto:|tel:|#)/iu.test(raw)) continue
    found.push({ file, raw, kind: 'link' })
  }
  for (const match of text.matchAll(BARE_SHARED_PATH)) {
    found.push({ file, raw: match[0], kind: 'shared' })
  }
  return found
}

/** Scan the whole vendored tree and classify every reference. */
async function scanVendoredReferences() {
  const files = (await walkFiles(vendorDir)).filter(name => name.toLowerCase().endsWith('.md')).sort()
  const resolved = []
  const missing = []
  let references = 0
  let placeholders = 0
  let links = 0
  let sharedPaths = 0
  for (const file of files) {
    const text = await readFile(join(vendorDir, file), 'utf8')
    for (const reference of referencesIn(file, text)) {
      const raw = normalizeReference(reference.raw)
      if (raw === '' || PLACEHOLDER.test(raw)) {
        placeholders += 1
        continue
      }
      references += 1
      if (reference.kind === 'link') links += 1
      else sharedPaths += 1
      const target = resolveReference(file, raw, reference.kind)
      const entry = { ...reference, target }
      if (await existsInsideVendor(target)) resolved.push(entry)
      else missing.push(entry)
    }
  }
  return { files, references, links, sharedPaths, placeholders, resolved, missing }
}

/** Distinct shared/ targets referenced from one skill tree, sorted. */
function sharedTargetsOf(scan, skillName) {
  return [...new Set(scan.resolved
    .filter(entry => entry.file.startsWith(skillName + '/'))
    .filter(entry => entry.target.startsWith('shared/'))
    .map(entry => entry.target))].sort()
}

/** Mount the provider on a real registry and load every expected skill body. */
async function servedSkills() {
  const ctx = new Context()
  const skills = new SkillRegistry(ctx)
  registerReviewSkillProvider(ctx, { providerName: 'academic-review', vendorBasePath: vendorRoot })
  const served = new Map()
  for (const name of EXPECTED_SERVED_SKILLS) served.set(name, await skills.get(name, { cwd: repoRoot }))
  return { skills, served }
}

/** The vendored body of one skill exactly as upstream stores it, frontmatter removed. */
async function vendoredBody(skillName) {
  const raw = await readFile(join(vendorDir, skillName, 'SKILL.md'), 'utf8')
  return parseSkillDocument(raw).body
}

/** UTF-8 byte length, the unit the release gate reports. */
function byteLength(text) {
  return Buffer.byteLength(text, 'utf8')
}

test('every vendored markdown reference resolves inside vendor/, except the unvendored upstream areas', async () => {
  const scan = await scanVendoredReferences()
  const manifest = JSON.parse(await readFile(join(repoRoot, 'vendor-manifest.json'), 'utf8'))

  const inPort = scan.missing.filter(entry => !UNVENDORED_UPSTREAM_AREAS.has(entry.target.split('/')[0]))
  const outOfPort = scan.missing.filter(entry => UNVENDORED_UPSTREAM_AREAS.has(entry.target.split('/')[0]))
  const outOfPortAreas = [...new Set(outOfPort.map(entry => entry.target.split('/')[0]))].sort()
  const distinctOutOfPortTargets = [...new Set(outOfPort.map(entry => entry.target))].sort()

  console.log('# reference integrity: '
    + String(scan.files.length) + ' markdown files scanned ('
    + String(EXPECTED_SERVED_SKILLS.length) + ' skills + shared/), '
    + String(scan.references) + ' references found ('
    + String(scan.links) + ' relative links + ' + String(scan.sharedPaths) + ' bare shared/ paths), '
    + String(scan.placeholders) + ' template placeholders skipped, '
    + String(scan.resolved.length) + ' resolved inside vendor/, '
    + String(inPort.length) + ' in-port dangling, '
    + String(outOfPort.length) + ' out-of-port references ('
    + String(distinctOutOfPortTargets.length) + ' distinct targets across '
    + String(outOfPortAreas.length) + ' unvendored upstream areas)')

  // The walk covers every skill and the shared tree the skills read.
  assert.deepEqual(
    [...new Set(scan.files.map(name => name.split('/')[0]))].sort(),
    [REVIEW_SKILL_NAME, DEEP_RESEARCH_SKILL_NAME, PAPER_SKILL_NAME, SCREENER_SKILL_NAME, 'shared'].sort(),
    'the walk must cover every vendored area',
  )
  // Pin the markdown counts per tree rather than comparing them to "whatever is
  // there": the tree is pinned by SHA-256, so these numbers are facts.
  const MARKDOWN_PER_SKILL = {
    [REVIEW_SKILL_NAME]: 28,
    [DEEP_RESEARCH_SKILL_NAME]: 53,
    [PAPER_SKILL_NAME]: 62,
    [SCREENER_SKILL_NAME]: 15,
  }
  for (const [skillName, expected] of Object.entries(MARKDOWN_PER_SKILL)) {
    assert.equal(
      scan.files.filter(name => name.startsWith(skillName + '/')).length,
      expected,
      'every ' + skillName + ' markdown file must be scanned',
    )
  }
  // Every tree's manifest total is its markdown count plus its payload count, and
  // the payloads are pinned here by hand: academic-paper ships one .tex, sr-screener
  // ships six .py, two .js and two .json. Nothing is special-cased by extension.
  const PAYLOAD_PER_SKILL = {
    [REVIEW_SKILL_NAME]: 0,
    [DEEP_RESEARCH_SKILL_NAME]: 0,
    [PAPER_SKILL_NAME]: 1,
    [SCREENER_SKILL_NAME]: 10,
  }
  for (const [skillName, payload] of Object.entries(PAYLOAD_PER_SKILL)) {
    const total = manifest.skills.find(skill => skill.name === skillName).fileCount
    assert.equal(total - MARKDOWN_PER_SKILL[skillName], payload,
      skillName + ' must ship ' + String(payload) + ' non-markdown file(s)')
  }
  // A hand-pinned catalog: the vendored set is four skills, not "however many".
  assert.deepEqual([...manifest.vendored.skills].sort(), [...EXPECTED_SERVED_SKILLS].sort())
  assert.ok(scan.files.length >= 170, 'expected the whole vendored tree, got ' + String(scan.files.length) + ' markdown files')
  assert.ok(scan.references >= 400, 'expected at least 400 references, got ' + String(scan.references))

  // No vendored file may reach outside the vendored tree.
  for (const entry of scan.missing) {
    assert.equal(entry.target.startsWith('..'), false, entry.file + ' references outside vendor/: ' + entry.raw)
  }

  // The invariant that matters: nothing in port dangles.
  assert.deepEqual(
    inPort.map(entry => entry.file + ' -> ' + entry.raw + ' (resolved ' + entry.target + ')'),
    [],
    'in-port references must resolve; fix the vendoring, do not edit the upstream text',
  )

  // Out-of-port references are reported, and the allowlist is two-sided so it
  // can neither absorb a new upstream area nor rot into a stale entry.
  assert.deepEqual(outOfPortAreas, [...UNVENDORED_UPSTREAM_AREAS.keys()].sort(), 'unvendored upstream areas changed')
  for (const entry of outOfPort) {
    assert.ok(
      UNVENDORED_UPSTREAM_AREAS.has(entry.target.split('/')[0]),
      entry.file + ' -> ' + entry.raw + ' is out of port without a recorded reason',
    )
  }
  // Every listed area must still be used, or the reason has gone stale.
  for (const area of UNVENDORED_UPSTREAM_AREAS.keys()) {
    assert.ok(outOfPortAreas.includes(area), 'stale allowlist entry: nothing references ' + area + '/ any more')
  }
  for (const target of distinctOutOfPortTargets) {
    console.log('# out of port: ' + target + '  <- referenced by '
      + [...new Set(outOfPort.filter(entry => entry.target === target).map(entry => entry.file))].join(', '))
  }
})

test('academic-paper references every one of its shared/ paths inside the vendored tree', async () => {
  const scan = await scanVendoredReferences()
  const targets = sharedTargetsOf(scan, PAPER_SKILL_NAME)
  const files = targets.filter(target => !target.endsWith('/'))
  const directories = targets.filter(target => target.endsWith('/'))

  console.log('# academic-paper: ' + String(targets.length) + ' distinct shared/ targets ('
    + String(files.length) + ' files + ' + String(directories.length) + ' directory references), all resolved')

  // Pinned, because the vendored tree is pinned by SHA-256: 30 distinct targets,
  // of which 2 name a directory that expands to further files.
  assert.equal(targets.length, 30, 'academic-paper should reach 30 distinct shared/ targets, saw ' + String(targets.length))
  assert.equal(files.length, 28, 'expected 28 file-shaped shared/ targets, saw ' + String(files.length))
  assert.deepEqual(directories, ['shared/contracts/patch/', 'shared/contracts/patch/legacy/v1_0/'])

  for (const target of targets) {
    assert.equal(target.startsWith('shared/'), true, target + ' is not under shared/')
    assert.equal(target.includes('..'), false, target + ' escapes shared/')
    assert.equal(await existsInsideVendor(target), true, 'academic-paper references a missing shared path: ' + target)
  }
  // ...and every one of them is actually shipped in the package manifest, not
  // merely present on this working copy.
  const manifest = JSON.parse(await readFile(join(repoRoot, 'vendor-manifest.json'), 'utf8'))
  for (const target of files) {
    assert.ok(manifest.files[target] !== undefined, target + ' is referenced but not pinned in vendor-manifest.json')
  }
})

test('the deep-research tree references 34 distinct shared/ paths and every one is vendored', async () => {
  const scan = await scanVendoredReferences()
  const targets = sharedTargetsOf(scan, DEEP_RESEARCH_SKILL_NAME)

  console.log('# deep-research: ' + String(targets.length) + ' distinct shared/ paths, all resolved')
  assert.equal(targets.length, 34, 'deep-research should reach 34 distinct shared/ paths, saw ' + String(targets.length))
  for (const target of targets) {
    assert.equal(target.startsWith('shared/'), true, target + ' is not under shared/')
    assert.equal(await existsInsideVendor(target), true, 'deep-research references a missing shared file: ' + target)
  }
})

test('the served payload keeps its order and its byte counts for all three skills', async (t) => {
  const { served } = await servedSkills()

  const reviewer = served.get(REVIEW_SKILL_NAME)
  const reviewerBody = await vendoredBody(REVIEW_SKILL_NAME)
  const research = served.get(DEEP_RESEARCH_SKILL_NAME)
  const researchBody = await vendoredBody(DEEP_RESEARCH_SKILL_NAME)
  const paper = served.get(PAPER_SKILL_NAME)
  const paperBody = await vendoredBody(PAPER_SKILL_NAME)
  const block = renderWritePolicyBlock(PAPER_SKILL_NAME)

  // CANARY: the reviewer's served bytes are the vendored bytes, full stop. Two
  // members have now added port text to served bodies; this is what catches a
  // third one doing it to the skill that must not change.
  assert.equal(reviewer.content, reviewerBody, 'the reviewer body must stay byte-identical to the vendored text')
  t.diagnostic('served bytes  ' + REVIEW_SKILL_NAME + ': ' + String(byteLength(reviewer.content))
    + ' = vendored body ' + String(byteLength(reviewerBody)) + ' (no block, no notice)')
  assert.equal(byteLength(reviewer.content), 47300, 'the reviewer served payload moved')

  // academic-paper: block, then body, then the appended port notice - in that order.
  assert.equal(paper.content.startsWith(WRITE_POLICY_BEGIN), true, 'the write-policy block must be first')
  assert.equal(paper.content.split(WRITE_POLICY_BEGIN).length, 2, 'exactly one write-policy block')
  assert.equal(paper.content.indexOf(WRITE_POLICY_END), block.lastIndexOf('<!-- dsh-academic-review:write-policy:end -->'))
  const blockEnd = paper.content.indexOf(WRITE_POLICY_END) + WRITE_POLICY_END.length
  const bodyStart = paper.content.indexOf(paperBody)
  const noticeStart = bodyStart + paperBody.length
  const notice = paper.content.slice(noticeStart)
  assert.ok(bodyStart >= blockEnd, 'the vendored body must follow the write-policy block (block ends ' + String(blockEnd) + ', body starts ' + String(bodyStart) + ')')
  assert.equal(paper.content.slice(0, blockEnd), block.slice(0, blockEnd), 'the block must be served verbatim, in front')
  assert.equal(notice.trimStart().startsWith(PORT_NOTICE_BEGIN), true, 'the appended port notice must come last, directly after the body')
  assert.equal(notice.includes('academic-pipeline/references/literature_corpus_consumers.md'), true,
    'the notice must name the file it is apologising for')
  assert.equal(notice.trimEnd().endsWith(PORT_NOTICE_END), true, 'the port notice must end the payload')
  assert.equal(paper.content.slice(noticeStart).includes(WRITE_POLICY_BEGIN), false, 'policy A must never appear after the body')
  assert.equal(paper.content.split(PORT_NOTICE_BEGIN).length, 2, 'exactly one port notice')
  t.diagnostic('served bytes  ' + PAPER_SKILL_NAME + ': ' + String(byteLength(paper.content))
    + ' = vendored body ' + String(byteLength(paperBody))
    + ' + write-policy block ' + String(byteLength(block))
    + ' + port notice ' + String(byteLength(notice)))
  assert.equal(byteLength(paper.content), 64978, 'the academic-paper served payload moved')
  assert.equal(byteLength(paperBody), 63857)
  assert.equal(byteLength(block), 549)
  assert.equal(byteLength(notice), 572)

  // deep-research: unchanged from the previous release apart from its own notice.
  assert.equal(research.content.startsWith(researchBody), true, 'the vendored deep-research body must be served first, verbatim')
  const researchNotice = research.content.slice(researchBody.length)
  assert.equal(research.content.includes(WRITE_POLICY_BEGIN), false, 'deep-research must not carry policy A')
  assert.equal(researchNotice.trimStart().startsWith(PORT_NOTICE_BEGIN), true)
  assert.equal(researchNotice.trimEnd().endsWith(PORT_NOTICE_END), true)
  assert.equal(research.content.split(PORT_NOTICE_BEGIN).length, 2, 'exactly one port notice')
  t.diagnostic('served bytes  ' + DEEP_RESEARCH_SKILL_NAME + ': ' + String(byteLength(research.content))
    + ' = vendored body ' + String(byteLength(researchBody))
    + ' + port notice ' + String(byteLength(researchNotice)) + ' (no write-policy block)')
  assert.equal(byteLength(research.content), 51632, 'the deep-research served payload moved')
  assert.equal(byteLength(researchBody), 51069)

  // The block travels with exactly the skill that writes: never the reviewer.
  assert.equal(reviewer.content.includes(WRITE_POLICY_BEGIN), false, 'the reviewer must not carry policy A')
  assert.equal(reviewer.content.includes(PORT_NOTICE_BEGIN), false, 'the reviewer must carry no port notice today')
})

test('the one non-markdown vendored file is pinned, CR-free and shipped in the package', async () => {
  const tex = 'academic-paper/templates/latex_article_template.tex'
  const absolute = join(vendorDir, tex)
  const bytes = await readFile(absolute)
  const manifest = JSON.parse(await readFile(join(repoRoot, 'vendor-manifest.json'), 'utf8'))
  const pkg = JSON.parse(await readFile(join(repoRoot, 'package.json'), 'utf8'))

  // Byte-identical to the upstream git object (repository bytes, not the
  // CRLF-converted upstream worktree copy of the same file).
  const digest = createHash('sha256').update(bytes).digest('hex')
  const carriageReturns = [...bytes].filter(byte => byte === 0x0d).length
  console.log('# .tex: ' + tex + ' ' + String(bytes.length) + ' bytes, sha256 ' + digest
    + ', CR bytes ' + String(carriageReturns) + ', LF bytes ' + String([...bytes].filter(byte => byte === 0x0a).length))
  assert.equal(bytes.length, 4844, 'the pinned upstream object is 4844 bytes')
  assert.equal(digest, '1f9112782a501b605d17ce644598cdd5e5ef250560198677266976038ccbc3c9',
    'the .tex must be byte-identical to the upstream object')
  assert.equal(digest, manifest.files[tex], 'the .tex digest must equal its manifest pin')
  assert.equal(bytes.includes(0x0d), false, 'the .tex carries CR, so something text-converted it')
  assert.equal(bytes.subarray(0, 1).toString('utf8'), '%', 'the .tex still opens with its LaTeX comment banner')
  assert.match(bytes.toString('utf8'), /\\documentclass/u)

  // "In the package", not merely in the working copy: vendor/ is a published
  // directory and the file sits inside it, so the tarball carries the template.
  assert.ok(pkg.files.includes('vendor'), 'package.json must ship the vendor directory')
  assert.equal(tex.startsWith('vendor/'), false, 'the .tex path is vendor-relative')
  assert.equal(await existsInsideVendor(tex), true)
  const templates = (await walkFiles(vendorDir)).filter(name => name.startsWith('academic-paper/templates/'))
  assert.equal(templates.length, 11, 'the academic-paper templates directory must ship 11 files, saw ' + String(templates.length))
  const nonMarkdown = templates.filter(name => !name.endsWith('.md'))
  assert.deepEqual(nonMarkdown, [tex], 'the .tex must be the only non-markdown template')
  for (const name of templates) assert.ok(manifest.files[name] !== undefined, name + ' ships without a pin')
})

test('the deep-research frontmatter parses and the provider serves it clean', async () => {
  const raw = await readFile(join(vendorDir, DEEP_RESEARCH_SKILL_NAME, 'SKILL.md'), 'utf8')
  assert.ok(raw.startsWith('---'), 'the vendored SKILL.md keeps its upstream frontmatter')
  const document = parseSkillDocument(raw)
  assert.equal(document.name, DEEP_RESEARCH_SKILL_NAME)
  assert.ok(typeof document.description === 'string' && document.description.trim().length > 200,
    'frontmatter description must be present and substantive, got ' + JSON.stringify(document.description))
  assert.match(document.description, /Triggers on: /u)
  assert.equal(document.metadata.version, '2.12.1')
  assert.equal(document.metadata.last_updated, '2026-08-15')
  assert.equal(document.body.startsWith('---'), false, 'the parsed body must not carry the frontmatter')
  assert.match(document.body, /^# Deep Research/mu)

  // Mount the real provider on a real registry and load every served skill, as a
  // session would. The catalog is asserted by name, not by "whatever is there".
  const { skills, served } = await servedSkills()
  const summaries = await skills.list({ cwd: repoRoot })
  assert.deepEqual(summaries.map(summary => summary.name), EXPECTED_SERVED_SKILLS)

  for (const name of EXPECTED_SERVED_SKILLS) {
    const definition = served.get(name)
    assert.ok(definition !== undefined, 'the provider must serve ' + name)
    assert.equal(definition.name, name)
    assert.equal(typeof definition.description, 'string')
    assert.ok(definition.description.trim().length > 0, name + ': served description must be non-empty')
    assert.equal(definition.content.startsWith('---'), false, name + ': served body must not start with the frontmatter fence')
    assert.ok(definition.content.length > 1000, name + ': served body looks truncated')
    assert.equal(definition.resourceBase.kind, 'directory')
    assert.equal(definition.resourceBase.path, join(vendorRoot, name))
  }

  const research = served.get(DEEP_RESEARCH_SKILL_NAME)
  assert.match(research.description, /deep research/iu)
  assert.equal(research.metadata.upstreamSkillVersion, '2.12.1')
  assert.equal(served.get(PAPER_SKILL_NAME).metadata.upstreamSkillVersion, '3.3.1')
})

test('the scanner itself detects a dangling reference (it is not a rubber stamp)', async () => {
  // Guard against the classic false pass: a walker that finds nothing asserts
  // nothing. Feed the pure helpers one good and one broken reference.
  const good = referencesIn('deep-research/SKILL.md', 'see [the agent](agents/research_question_agent.md) and shared/mode_spectrum.md')
  assert.deepEqual(good.map(entry => entry.raw), ['agents/research_question_agent.md', 'shared/mode_spectrum.md'])
  assert.equal(resolveReference('deep-research/SKILL.md', 'agents/research_question_agent.md', 'link'), 'deep-research/agents/research_question_agent.md')
  assert.equal(await existsInsideVendor('deep-research/agents/research_question_agent.md'), true)

  const broken = referencesIn('deep-research/SKILL.md', 'see [gone](agents/no_such_agent.md)')
  assert.equal(resolveReference('deep-research/SKILL.md', broken[0].raw, 'link'), 'deep-research/agents/no_such_agent.md')
  assert.equal(await existsInsideVendor('deep-research/agents/no_such_agent.md'), false)

  // A link inside a code span is an example, not a reference (commit 3b27680).
  assert.deepEqual(referencesIn('academic-paper/agents/formatter_agent.md', '| `[text](url)` | `\\href{url}{text}` |'), [])
  // ...but a bare shared/ path inside a code span IS a pointer the agent opens.
  assert.deepEqual(
    referencesIn('academic-paper/SKILL.md', 'read `shared/mode_spectrum.md` next').map(entry => entry.raw),
    ['shared/mode_spectrum.md'],
  )
  // Placeholders are not references; external URLs and anchors are ignored.
  assert.deepEqual(
    referencesIn('shared/handoff_schemas.md', 'shared/contracts/<domain>/<mode>.json and [web](https://example.org) and [here](#anchor)')
      .map(entry => entry.raw),
    ['shared/contracts/<domain>/<mode>.json'],
  )
  assert.equal(PLACEHOLDER.test('shared/contracts/<domain>/<mode>.json'), true)
  // An unclosed code span must not swallow the rest of the document: the link is
  // still found, and the same token also reads as a bare shared/ path.
  assert.deepEqual(
    [...new Set(referencesIn('x.md', 'a ` dangling fence [l](shared/mode_spectrum.md)').map(entry => entry.raw))],
    ['shared/mode_spectrum.md'],
  )
})