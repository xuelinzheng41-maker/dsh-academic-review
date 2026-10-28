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
 * WHAT THIS SCANNER READS, AND WHAT IT DOES NOT (a fourth skill now ships payload):
 * - it reads MARKDOWN ONLY - .md under vendor/. 89 of the 279 vendored files are
 *   .json (79), .py (6), .js (2), .tex (1) and .yaml (1), and none of them is a
 *   reference-bearing document: a path inside a Python docstring or a JSON-schema
 *   string is data that a program consumes, not an instruction telling the agent to
 *   open a file in this port. Reading them would manufacture references - the JSON
 *   schemas alone contain shared/... names and ](...) regex fragments - and the
 *   test below proves that exclusion is load-bearing rather than vacuous;
 * - it does not follow links out of the tree, does not fetch anything, and does not
 *   evaluate any payload: it is a text walk plus a stat() per reference.
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

/** The fifth vendored skill (0.5.0): the only one whose own tree names unvendored paths. */
const PIPELINE_SKILL_NAME = 'academic-pipeline'

/**
 * The served catalog, pinned by hand. vendor-integrity.test.mjs pins the same
 * set against the manifest; this file pins it against the provider, because a
 * test that merely iterates whatever happens to be vendored proves less than one
 * that states what it expects to find.
 */
const EXPECTED_SERVED_SKILLS = [
  'academic-paper',
  REVIEW_SKILL_NAME,
  PIPELINE_SKILL_NAME,
  DEEP_RESEARCH_SKILL_NAME,
  SCREENER_SKILL_NAME,
]

/**
 * Upstream areas a vendored file may name without the target being vendored
 * here, with the reason each one is out of port. These are REPORTED, never fixed
 * by editing vendored text or by adding files: the port vendors exactly the
 * skills the plugin serves plus their shared/ closure.
 */
const UNVENDORED_UPSTREAM_AREAS = new Map([
  // 'academic-pipeline' was listed here until 0.5.0, when that skill became the fifth
  // vendored tree. It is deliberately GONE rather than kept as a tolerated area: a
  // reference to academic-pipeline/... is in port now, so it must resolve and a miss has
  // to fail. The stale-entry check below is what forced this edit rather than letting the
  // allowlist quietly absorb the tree it used to excuse.
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

/**
 * The canonical separator between the write-policy block and the vendored body: ONE blank
 * line, i.e. exactly two newlines. Measured, not assumed: all five served payloads put the
 * body there (the test below prints the seam per skill), so a difference would be a finding
 * and not something to normalise.
 */
const BODY_SEAM = '\n\n'

/**
 * The seam checker: the block, then the body, and NOTHING in between.
 *
 * The property is not cosmetic. The block is only a pre-emptive rule if it is the last thing
 * the model reads before the skill's own instructions, and text sitting between the two is
 * read as part of the rule while belonging to neither: a line there could relax the rule
 * ("the above does not apply to drafts/") without appearing in any vendored file. Equality
 * with BODY_SEAM is what rejects that: one smuggled line changes the separator, and a missing
 * separator changes it the other way.
 *
 * @returns the character offset just past the block, so a caller can print what it saw.
 */
function assertBodyFollowsBlock(label, content, block, body) {
  assert.equal(content.startsWith(block), true, label + ': the write-policy block must be the first thing served')
  const blockEnd = content.indexOf(WRITE_POLICY_END) + WRITE_POLICY_END.length
  const bodyStart = content.indexOf(body)
  assert.equal(bodyStart === content.lastIndexOf(body), true, label + ': the vendored body must occur exactly once')
  // The seam is asserted FIRST, and by equality with the canonical separator: it is the one
  // assertion that rejects every way of putting something between the block and the body
  // (a line, an extra newline, a second block, a block that lost its trailing blank line),
  // and it says what it saw.
  const seam = content.slice(blockEnd, bodyStart)
  assert.equal(seam, BODY_SEAM,
    label + ': exactly one blank line may separate the policy block from the body, saw ' + JSON.stringify(seam))
  assert.ok(bodyStart > blockEnd, label + ': the vendored body must follow the block (body at '
    + String(bodyStart) + ', block ends ' + String(blockEnd) + ')')
  return blockEnd
}

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
    [REVIEW_SKILL_NAME, DEEP_RESEARCH_SKILL_NAME, PAPER_SKILL_NAME, SCREENER_SKILL_NAME, PIPELINE_SKILL_NAME, 'shared'].sort(),
    'the walk must cover every vendored area',
  )
  // Pin the markdown counts per tree rather than comparing them to "whatever is
  // there": the tree is pinned by SHA-256, so these numbers are facts.
  const MARKDOWN_PER_SKILL = {
    [REVIEW_SKILL_NAME]: 28,
    [DEEP_RESEARCH_SKILL_NAME]: 53,
    [PAPER_SKILL_NAME]: 62,
    [SCREENER_SKILL_NAME]: 15,
    [PIPELINE_SKILL_NAME]: 29,
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
    // The fifth tree's one payload file is a .gitkeep, which is the point: the rule is
    // 'markdown plus payload equals the manifest total', not 'payload means code'.
    [PIPELINE_SKILL_NAME]: 1,
  }
  for (const [skillName, payload] of Object.entries(PAYLOAD_PER_SKILL)) {
    const total = manifest.skills.find(skill => skill.name === skillName).fileCount
    assert.equal(total - MARKDOWN_PER_SKILL[skillName], payload,
      skillName + ' must ship ' + String(payload) + ' non-markdown file(s)')
  }
  // A hand-pinned catalog: the vendored set is exactly these skills, not "however many".
  assert.deepEqual([...manifest.vendored.skills].sort(), [...EXPECTED_SERVED_SKILLS].sort())
  assert.ok(scan.files.length >= 222, 'expected the whole vendored tree (222 markdown files), got ' + String(scan.files.length))
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

test('the served payload keeps its order and its byte counts (reviewer canary, the pipeline notice, two former notices)', async (t) => {
  const { served } = await servedSkills()

  const reviewer = served.get(REVIEW_SKILL_NAME)
  const reviewerBody = await vendoredBody(REVIEW_SKILL_NAME)
  const research = served.get(DEEP_RESEARCH_SKILL_NAME)
  const researchBody = await vendoredBody(DEEP_RESEARCH_SKILL_NAME)
  const paper = served.get(PAPER_SKILL_NAME)
  const paperBody = await vendoredBody(PAPER_SKILL_NAME)
  const pipeline = served.get(PIPELINE_SKILL_NAME)
  const pipelineBody = await vendoredBody(PIPELINE_SKILL_NAME)
  const block = renderWritePolicyBlock()

  // CANARY, RE-AIMED. It used to be "the reviewer is its vendored body, nothing prepended
  // and nothing appended". Since 3f16ec3 the rule is attached to every served skill - the
  // detector cannot prove a skill never writes, so nothing is selected any more - which
  // means the reviewer legitimately starts with the block. What the canary must still
  // catch is what it was always for: a third member adding port text to a served BODY.
  // So the body is asserted byte-identical after the block, and the notice is asserted
  // absent; the rule's presence is asserted as exactly one block, not as zero.
  assert.equal(reviewer.content.startsWith(block), true, 'the write-policy block must be first, for every served skill')
  assert.equal(reviewer.content.slice(block.length), reviewerBody, 'the reviewer body must stay byte-identical to the vendored text')
  assert.equal(reviewer.content.includes(PORT_NOTICE_BEGIN), false, 'the reviewer must carry no port notice today')
  assert.equal(reviewer.content.split(WRITE_POLICY_BEGIN).length, 2, 'exactly one write-policy block on the reviewer')
  t.diagnostic('served bytes  ' + REVIEW_SKILL_NAME + ': ' + String(byteLength(reviewer.content))
    + ' = write-policy block ' + String(byteLength(block)) + ' + vendored body ' + String(byteLength(reviewerBody)) + ' (no notice)')
  assert.equal(byteLength(reviewer.content), 47984, 'the reviewer served payload moved')
  assert.equal(byteLength(reviewerBody), 47300)

  // academic-paper: block, then the vendored body verbatim, and nothing after it. This
  // tree carried the appended port notice until 0.5.0; the academic-pipeline tree now
  // supplies the paths the paper markdown names, so the notice is gone and the payload is
  // 572 bytes shorter. The absence is asserted WITH that arithmetic - a shrink with no
  // recorded cause is indistinguishable from a body that lost text - and the ORDER
  // assertions moved to academic-pipeline below rather than being deleted with the subject.
  assert.equal(paper.content.startsWith(WRITE_POLICY_BEGIN), true, 'the write-policy block must be first')
  assert.equal(paper.content.split(WRITE_POLICY_BEGIN).length, 2, 'exactly one write-policy block')
  assert.equal(paper.content.indexOf(WRITE_POLICY_END), block.lastIndexOf('<!-- dsh-academic-review:write-policy:end -->'))
  const blockEnd = paper.content.indexOf(WRITE_POLICY_END) + WRITE_POLICY_END.length
  const bodyStart = paper.content.indexOf(paperBody)
  assert.ok(bodyStart >= blockEnd, 'the vendored body must follow the write-policy block (block ends ' + String(blockEnd) + ', body starts ' + String(bodyStart) + ')')
  assert.equal(paper.content.slice(0, blockEnd), block.slice(0, blockEnd), 'the block must be served verbatim, in front')
  assert.equal(paper.content, block + paperBody, 'academic-paper must be served as block + body, with nothing appended')
  assert.equal(paper.content.includes(PORT_NOTICE_BEGIN), false, 'the paper tree resolves now, so it earns no notice')
  assert.equal(paper.content.includes(PORT_NOTICE_END), false)
  t.diagnostic('served bytes  ' + PAPER_SKILL_NAME + ': ' + String(byteLength(paper.content))
    + ' = vendored body ' + String(byteLength(paperBody))
    + ' + write-policy block ' + String(byteLength(block))
    + ' + port notice 0')
  assert.equal(byteLength(paper.content), 64541, 'the academic-paper served payload moved')
  assert.equal(byteLength(paperBody), 63857)
  assert.equal(byteLength(block), 684)
  assert.equal(65113 - byteLength(paper.content), 572,
    'academic-paper must have shrunk by exactly the notice it no longer needs (572 bytes) and nothing else')

  // deep-research: block, then the vendored body verbatim, and nothing after it. Its one
  // missing reference is vendored now, so its notice is gone too (563 bytes).
  assert.equal(research.content.startsWith(block), true, 'the write-policy block must be first, for every served skill')
  assert.equal(research.content.slice(block.length), researchBody,
    'the vendored deep-research body must be served verbatim, directly after the block, with nothing appended')
  assert.equal(research.content.split(WRITE_POLICY_BEGIN).length, 2, 'exactly one write-policy block on deep-research')
  assert.equal(research.content.includes(PORT_NOTICE_BEGIN), false, 'deep-research earns no notice now: the file it named is vendored')
  t.diagnostic('served bytes  ' + DEEP_RESEARCH_SKILL_NAME + ': ' + String(byteLength(research.content))
    + ' = write-policy block ' + String(byteLength(block)) + ' + vendored body ' + String(byteLength(researchBody))
    + ' + port notice 0')
  assert.equal(byteLength(research.content), 51753, 'the deep-research served payload moved')
  assert.equal(byteLength(researchBody), 51069)
  assert.equal(52316 - byteLength(research.content), 563,
    'deep-research must have shrunk by exactly the notice it no longer needs (563 bytes) and nothing else')

  // academic-pipeline: the ORDER this test exists for, asserted on the one skill that still
  // earns a notice - write-policy block, then the vendored body verbatim, then the notice,
  // which ends the payload. Same assertions the paper tree used to carry, so the property
  // is still tested and the tree it is tested on is the one that can exercise it.
  assert.equal(pipeline.content.startsWith(block), true, 'the write-policy block must be first, for every served skill')
  const pipelineBlockEnd = assertBodyFollowsBlock(PIPELINE_SKILL_NAME, pipeline.content, block, pipelineBody)
  const pipelineBodyStart = pipeline.content.indexOf(pipelineBody)
  assert.equal(pipeline.content.slice(0, pipelineBlockEnd), block.slice(0, pipelineBlockEnd), 'the block must be served verbatim, in front')
  const pipelineNotice = pipeline.content.slice(pipelineBodyStart + pipelineBody.length)
  assert.equal(pipelineNotice.trimStart().startsWith(PORT_NOTICE_BEGIN), true,
    'the appended port notice must come last, directly after the body')
  assert.equal(pipelineNotice.trimEnd().endsWith(PORT_NOTICE_END), true, 'the port notice must end the payload')
  assert.equal(pipelineNotice.includes('docs/PERFORMANCE.md'), true, 'the notice must name the files it is apologising for')
  assert.equal(pipelineNotice.includes(WRITE_POLICY_BEGIN), false, 'policy A must never appear after the body')
  assert.equal(pipeline.content.split(PORT_NOTICE_BEGIN).length, 2, 'exactly one port notice')
  assert.equal(pipeline.content.split(WRITE_POLICY_BEGIN).length, 2, 'exactly one write-policy block on academic-pipeline')
  t.diagnostic('served bytes  ' + PIPELINE_SKILL_NAME + ': ' + String(byteLength(pipeline.content))
    + ' = write-policy block ' + String(byteLength(block)) + ' + vendored body ' + String(byteLength(pipelineBody))
    + ' + port notice ' + String(byteLength(pipelineNotice)))
  assert.equal(byteLength(pipeline.content), 59934, 'the academic-pipeline served payload moved')
  assert.equal(byteLength(pipelineBody), 58397)
  assert.equal(byteLength(pipelineNotice), 853)
  assert.equal(byteLength(block) + byteLength(pipelineBody) + byteLength(pipelineNotice), byteLength(pipeline.content),
    'the pipeline payload must be exactly block + body + notice')

  // The block is attached to every served skill and to nothing else: it is not in the
  // metadata twice, not in the notice, and never after the body.
  assert.equal(paper.content.slice(block.length + paperBody.length).includes(WRITE_POLICY_BEGIN), false,
    'the block must appear before the body and only there')
  assert.equal(pipeline.content.slice(block.length + pipelineBody.length).includes(WRITE_POLICY_BEGIN), false,
    'not on the pipeline either: the notice carries no policy text')
  assert.equal(reviewer.content.split(WRITE_POLICY_BEGIN).length - 1, 1, 'the reviewer carries it exactly once')
  assert.equal(research.content.split(WRITE_POLICY_BEGIN).length - 1, 1, 'deep-research carries it exactly once')

  // The seam is a property of every served payload, not of the one tree that earns a notice:
  // checked on all five so that a tree whose body starts with its own heading (or with a
  // blank line of its own) cannot quietly change the separator on that one skill only.
  for (const skillName of EXPECTED_SERVED_SKILLS) {
    const definition = served.get(skillName)
    const vendored = await vendoredBody(skillName)
    const blockEnd = assertBodyFollowsBlock(skillName, definition.content, block, vendored)
    const seam = definition.content.slice(blockEnd, definition.content.indexOf(vendored))
    t.diagnostic('seam ' + skillName.padEnd(24) + ' ' + JSON.stringify(seam) + ' (block ends ' + String(blockEnd) + ')')
  }
})

/**
 * The checker above is only worth its assertions if it can reject something, so it is driven
 * with payloads built from the REAL block and a fixture body. The seams are the shapes a
 * third party could actually produce by editing the provider: a line between rule and body
 * (the one that matters - it would be read as part of the rule), one blank line too many, no
 * separator at all, and the block attached twice.
 */
test('the block/body seam checker bites: a smuggled line, an extra blank line, a missing separator and a doubled block are all rejected', () => {
  const block = renderWritePolicyBlock()
  const body = '# Fixture skill' + String.fromCharCode(10, 10) + 'A short fixture body.' + String.fromCharCode(10)

  // The canonical shape is accepted, so the checker is not merely rejecting everything.
  assert.equal(assertBodyFollowsBlock('canonical', block + body, block, body) > 0, true)

  const smuggled = block + 'This rule does not apply to drafts/.' + String.fromCharCode(10) + body
  const cases = [
    ['a line smuggled between block and body', smuggled, /exactly one blank line may separate/],
    ['one blank line too many', block + String.fromCharCode(10) + body, /exactly one blank line may separate/],
    ['the block attached twice', block + block + body, /exactly one blank line may separate/],
  ]
  const rejected = []
  for (const [label, content, pattern] of cases) {
    assert.throws(() => assertBodyFollowsBlock(label, content, block, body), pattern, label + ' must be rejected')
    rejected.push(label)
  }
  // The fourth shape is a BLOCK that ends without its blank line, which is what a renderer
  // change would look like: the separator comes from the block's own tail, so this must fail
  // on the seam assertion and not on the prefix check.
  const trimmedBlock = block.trimEnd()
  assert.throws(() => assertBodyFollowsBlock('no separator', trimmedBlock + body, trimmedBlock, body),
    /exactly one blank line may separate/, 'a block with no trailing blank line must be rejected')
  rejected.push('no separator after the block')
  console.log('# seam checker: the canonical payload is accepted and ' + String(rejected.length) + ' wrong shapes are rejected ('
    + rejected.join('; ') + '); the separator must be exactly ' + JSON.stringify(BODY_SEAM)
    + ', so text cannot be smuggled between the rule and the body it governs')
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

test('the walk reads markdown only, and the payload really would be misread if it did not', async () => {
  const all = await walkFiles(vendorDir)
  const payload = all.filter(name => name.endsWith('.md') === false).sort()
  const scan = await scanVendoredReferences()

  // Nothing but markdown was read. This is the rule, stated as an assertion.
  const nonMarkdownRead = scan.files.filter(name => name.endsWith('.md') === false)
  assert.deepEqual(nonMarkdownRead, [], 'the walk must read markdown only, it also read: ' + nonMarkdownRead.join(', '))
  const scanned = new Set(scan.files)

  // ...and the rule has teeth: payload files contain plenty of text that the same
  // patterns would treat as references, so an extension-agnostic walk would not be
  // a harmless no-op - it would invent references and fail on paths that no skill
  // instruction ever asks for.
  let wouldBe = 0
  let wouldBeDangling = 0
  const carriers = []
  for (const name of payload) {
    const text = await readFile(join(vendorDir, name), 'utf8')
    const found = referencesIn(name, text)
    if (found.length === 0) continue
    let dangling = 0
    for (const reference of found) {
      const raw = normalizeReference(reference.raw)
      if (raw === '' || PLACEHOLDER.test(raw)) continue
      if ((await existsInsideVendor(resolveReference(name, raw, reference.kind))) === false) dangling += 1
    }
    carriers.push({ name, count: found.length, dangling })
    wouldBe += found.length
    wouldBeDangling += dangling
  }
  assert.ok(wouldBe > 0, 'expected payload files to contain reference-shaped text; if none does, this test proves nothing')
  assert.ok(carriers.length >= 5, 'expected several payload files to carry reference-shaped text, saw ' + String(carriers.length))
  for (const carrier of carriers) {
    assert.equal(scanned.has(carrier.name), false, carrier.name + ' is not markdown and must not be scanned')
  }
  console.log('# the walk read ' + String(scan.files.length) + ' markdown files and 0 of the ' + String(payload.length)
    + ' payload files; ' + String(carriers.length) + ' payload files carry ' + String(wouldBe)
    + ' reference-shaped string(s) (' + String(wouldBeDangling) + ' of them would dangle), so the exclusion is load-bearing')
})

/**
 * Every shared/ target one skill tree reaches: the paths its own markdown names,
 * plus the ones the shared/ markdown it opens names in turn, to a fixpoint. Built on
 * the provider's scanner primitives (referencesIn / normalizeReference /
 * resolveReference / existsInside), so this is the same notion of "a reference" that
 * the walk above and the port notice use - only the union is mine.
 */
async function sharedReachOf(skillName) {
  const files = (await walkFiles(join(vendorDir, skillName)))
    .filter(name => name.endsWith('.md'))
    .map(name => skillName + '/' + name)
  const reach = new Set()
  const queue = [...files]
  const walked = new Set()
  while (queue.length > 0) {
    const file = queue.shift()
    if (walked.has(file)) continue
    walked.add(file)
    let text
    try {
      text = await readFile(join(vendorDir, file), 'utf8')
    } catch {
      continue
    }
    for (const reference of referencesIn(file, text)) {
      const raw = normalizeReference(reference.raw)
      if (raw === '' || PLACEHOLDER.test(raw)) continue
      const target = resolveReference(file, raw, reference.kind)
      if (target.startsWith('shared/') === false) continue
      if ((await existsInsideVendor(target)) === false) continue
      reach.add(target)
      if (target.endsWith('.md') && walked.has(target) === false) queue.push(target)
    }
  }
  return reach
}

test('the fourth skill adds no shared file to the closure, computed rather than assumed', async () => {
  // WHAT THE PROSE CLAIMS: "shared did not change - sr-screener names shared/ paths
  // that were already in the closure". That is a claim about a DIFFERENCE BETWEEN TWO
  // COMPUTED SETS, so it is asserted as one. A constant would not do the job: the
  // shared size is already pinned as 110 elsewhere, so a regression from 108 to 109
  // fails those pins while saying nothing about which tree caused it. Worse, a
  // resolver that lacks bare-filename-relative resolution counts 106 where the
  // official one counts 108 - the absolute number is resolver-dependent, the
  // differential is not, which is exactly why this comparison is the right shape.
  const olderTrees = [REVIEW_SKILL_NAME, DEEP_RESEARCH_SKILL_NAME, PAPER_SKILL_NAME]
  const threeReach = new Set()
  for (const skill of olderTrees) for (const target of await sharedReachOf(skill)) threeReach.add(target)
  const screenerReach = await sharedReachOf(SCREENER_SKILL_NAME)
  const fourReach = new Set([...threeReach, ...screenerReach])

  const threeSorted = [...threeReach].sort()
  const fourSorted = [...fourReach].sort()
  assert.deepEqual(fourSorted, threeSorted,
    'adding ' + SCREENER_SKILL_NAME + ' must not add a shared/ target to the closure; it added '
    + fourSorted.filter(target => threeReach.has(target) === false).join(', '))
  assert.equal(fourReach.size - threeReach.size, 0, 'the closure differential must be zero')

  // The five paths sr-screener is documented to name, each a member of the closure.
  const SCREENER_SHARED_REFS = [
    'shared/ground_truth_isolation_pattern.md',
    'shared/references/routing_core.md',
    'shared/references/intent_clarification_protocol.md',
    'shared/contracts/passport/literature_corpus_entry.schema.json',
    'shared/model_tiering.md',
  ]
  for (const target of SCREENER_SHARED_REFS) {
    assert.equal(screenerReach.has(target), true, SCREENER_SKILL_NAME + ' is documented to name ' + target + ' but does not')
    assert.equal(threeReach.has(target), true, target + ' must already have been in the closure before the fourth skill arrived')
  }
  // ...and the general form of the same claim: everything the fourth tree reaches was
  // already reachable, not just the five paths in the documentation.
  assert.deepEqual([...screenerReach].filter(target => threeReach.has(target) === false).sort(), [],
    'sr-screener reaches a shared/ target the older trees did not')

  console.log('# shared closure: ' + String(threeReach.size) + ' distinct shared/ targets reached by the three older trees, '
    + String(fourReach.size) + ' by all four, differential ' + String(fourReach.size - threeReach.size)
    + '; ' + SCREENER_SKILL_NAME + ' reaches ' + String(screenerReach.size)
    + ', every one already in the closure, and all five documented paths are members')
})
