/**
 * Write policy A tests (P3-2, t19).
 *
 * academic-paper is the first vendored skill that instructs the model to write
 * files. policy A ("new paths only") is prepended to its served body so the rule
 * is read before the drafting instructions, and mirrored in metadata. The
 * reviewer and deep-research bodies must not move by a byte.
 *
 * What this DOES NOT prove: that a write cannot happen. The plugin never sees the
 * host's file tools, so policy A is an instruction, not an interlock; these tests
 * check that the instruction is present, first, honest about itself, and that it
 * travels with exactly the skills that write.
 */
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import { Context } from '@deepseek-ai/cordis'
import { SkillRegistry } from '@deepseek-ai/dsh-skill'
import { ToolRuntime } from '@deepseek-ai/dsh-tools'
import * as plugin from '../lib/index.js'
import {
  DEEP_RESEARCH_SKILL_NAME,
  PORT_NOTICE_BEGIN,
  PORT_NOTICE_END,
  REVIEW_SKILL_NAME,
  VendoredSkillsProvider,
  defaultVendorBasePath,
  discoverVendoredSkills,
  parseSkillDocument,
} from '../lib/skills.js'
import {
  FILE_PRODUCING_MIN_DRAFTING_VERBS,
  FILE_PRODUCING_MIN_WRITING_VERBS,
  FILE_PRODUCING_SKILLS,
  WRITE_POLICY_BEGIN,
  WRITE_POLICY_END,
  WRITE_POLICY_NEW_PATHS_ONLY,
  fileProducingEntry,
  fileProductionSignals,
  producesFiles,
  renderWritePolicyBlock,
} from '../lib/write-policy.js'

const repoRoot = fileURLToPath(new URL('..', import.meta.url))
const vendorRoot = defaultVendorBasePath()
const PAPER_SKILL_NAME = 'academic-paper'

/** Registration control stand-in; the provider only reads it passively. */
function control() {
  return { signal: new AbortController().signal, invalidate: () => {} }
}

/** Provider over the real vendored tree. */
function provider(config = {}) {
  return new VendoredSkillsProvider({ providerName: 'academic-review', ...config }, control())
}

/** The vendored body of one skill, exactly as stored on disk. */
async function vendoredBody(skillName) {
  const raw = await readFile(join(vendorRoot, skillName, 'SKILL.md'), 'utf8')
  return parseSkillDocument(raw).body
}

/** Load one served definition by name from a fresh provider. */
async function served(skillName) {
  const instance = provider()
  const candidates = await instance.list()
  const candidate = candidates.find(item => item.name === skillName)
  assert.ok(candidate !== undefined, 'skill not served: ' + skillName)
  const definition = await instance.get(candidate, {})
  assert.ok(definition !== undefined)
  return definition
}

test('the table names exactly the vendored skills whose SKILL.md instructs writing (both directions)', async () => {
  const vendored = discoverVendoredSkills(vendorRoot)
  assert.ok(vendored.length >= 3, 'expected the three vendored skills, got ' + vendored.join(', '))

  const measured = []
  for (const skillName of vendored) {
    const signals = fileProductionSignals(await vendoredBody(skillName))
    measured.push({ skillName, signals })
  }

  const detected = new Set(measured.filter(entry => entry.signals.producesFiles).map(entry => entry.skillName))
  const tabulated = new Set(FILE_PRODUCING_SKILLS.map(entry => entry.skill))
  const table = () => [...tabulated].sort().join(', ') || '(empty)'
  const rule = () => [...detected].sort().join(', ') || '(empty)'

  // Direction 1: the rule found a writer the table forgot to list.
  for (const entry of measured) {
    if (!entry.signals.producesFiles) continue
    assert.equal(tabulated.has(entry.skillName), true,
      entry.skillName + ' matches the write/draft rule (' + entry.signals.verdict + ') but is missing from FILE_PRODUCING_SKILLS; table=' + table())
  }
  // Direction 2: the table lists a skill the rule does not match (stale entry).
  for (const entry of FILE_PRODUCING_SKILLS) {
    assert.equal(vendored.includes(entry.skill), true, 'FILE_PRODUCING_SKILLS names ' + entry.skill + ', which is not vendored')
    const signals = measured.find(item => item.skillName === entry.skill)
    assert.ok(signals !== undefined)
    assert.equal(signals.signals.producesFiles, true,
      'FILE_PRODUCING_SKILLS lists ' + entry.skill + ' but its SKILL.md does not match (' + signals.signals.verdict + '); detected=' + rule())
  }
  // And the two sets agree exactly, so neither direction can drift alone.
  assert.deepEqual([...tabulated].sort(), [...detected].sort())

  // The thresholds stay in the measured gap rather than on a knife edge: the
  // nearest non-writer must sit well below both, the writer well above.
  const nonWriters = measured.filter(entry => !entry.signals.producesFiles)
  for (const entry of nonWriters) {
    assert.ok(entry.signals.writingVerbs < FILE_PRODUCING_MIN_WRITING_VERBS, entry.skillName + ' writing verbs ' + entry.signals.writingVerbs)
    assert.ok(entry.signals.draftingVerbs < FILE_PRODUCING_MIN_DRAFTING_VERBS, entry.skillName + ' drafting verbs ' + entry.signals.draftingVerbs)
  }
})

test('every table entry carries a one-line justification', () => {
  assert.ok(FILE_PRODUCING_SKILLS.length > 0)
  for (const entry of FILE_PRODUCING_SKILLS) {
    assert.equal(typeof entry.reason, 'string')
    assert.ok(entry.reason.trim().length > 40, entry.skill + ' reason is too short to be a justification')
    assert.equal(entry.reason.includes('\n'), false, entry.skill + ' reason must be one line')
    assert.ok(entry.reason.length <= 220, entry.skill + ' reason must stay one line at normal widths')
    assert.equal(fileProducingEntry(entry.skill)?.skill, entry.skill)
  }
  assert.equal(fileProducingEntry(REVIEW_SKILL_NAME), undefined)
  assert.equal(fileProducingEntry(DEEP_RESEARCH_SKILL_NAME), undefined)
  assert.equal(producesFiles('# Nothing here\n\nThis skill only reviews text.\n'), false)
})

test('academic-paper is served with policy A prepended, before any drafting instruction', async () => {
  const definition = await served(PAPER_SKILL_NAME)
  const body = await vendoredBody(PAPER_SKILL_NAME)
  const block = renderWritePolicyBlock(PAPER_SKILL_NAME)

  // Prepended, exactly once, and the vendored body follows it untouched.
  assert.equal(definition.content.startsWith(WRITE_POLICY_BEGIN), true, 'the block must be the first thing the model reads')
  assert.equal(definition.content.indexOf(WRITE_POLICY_BEGIN), definition.content.lastIndexOf(WRITE_POLICY_BEGIN))
  assert.equal(definition.content.indexOf(body), block.length, 'the vendored body must follow the block verbatim')
  assert.equal(definition.content.indexOf(WRITE_POLICY_END) < definition.content.indexOf(body), true)

  // Ordering, stated the way the model experiences it: the closing marker of the
  // rule must come before the body's first write/draft instruction.
  const ruleEnd = definition.content.indexOf(WRITE_POLICY_END)
  const firstDraftingInstruction = definition.content.slice(block.length).search(/\b(?:write|draft)\b/iu)
  assert.ok(firstDraftingInstruction > 0, 'the body should mention writing somewhere')
  assert.ok(ruleEnd < block.length + firstDraftingInstruction,
    'the rule must be read before the body instructs any writing')

  // Short enough to be a header, not a second document.
  const blockLines = block.split('\n')
  assert.ok(blockLines.filter(line => line.length > 0).length <= 10, 'block has ' + blockLines.filter(line => line.length > 0).length + ' non-empty lines')
  assert.ok(blockLines.length <= 11, 'block has ' + blockLines.length + ' raw lines')
  assert.equal(blockLines[0], WRITE_POLICY_BEGIN)
  assert.equal(blockLines[blockLines.length - 3], WRITE_POLICY_END)

  // The three rules, and the honesty line, are all present.
  assert.match(block, /not upstream text/iu)
  assert.match(block, /never overwrite, move, rename or delete an existing file/iu)
  assert.match(block, /new path/iu)
  assert.match(block, /choose a new name/iu)
  assert.match(block, /tell the user/iu)
  assert.match(block, /cannot enforce/iu)
  assert.match(block, /never sees your file tools/iu)
  assert.match(block, /stop and ask the user/iu)
})

test('write policy is mirrored in metadata, and only for skills that carry it', async () => {
  const paper = await served(PAPER_SKILL_NAME)
  assert.equal(paper.metadata.writePolicy, WRITE_POLICY_NEW_PATHS_ONLY)
  // The machine-readable honesty boundary: no consumer may read this as an interlock.
  assert.equal(paper.metadata.writePolicyEnforced, false)

  for (const skillName of [REVIEW_SKILL_NAME, DEEP_RESEARCH_SKILL_NAME]) {
    const definition = await served(skillName)
    assert.equal(definition.metadata.writePolicy, undefined, skillName + ' must not advertise a write policy')
    assert.equal(definition.metadata.writePolicyEnforced, undefined)
    assert.equal(definition.content.includes(WRITE_POLICY_BEGIN), false, skillName + ' must not carry the block')
  }
  assert.equal(renderWritePolicyBlock(REVIEW_SKILL_NAME), '')
  assert.equal(renderWritePolicyBlock(DEEP_RESEARCH_SKILL_NAME), '')
  assert.equal(renderWritePolicyBlock('not-a-skill'), '')
})

test('reviewer and deep-research bodies are byte-identical to today', async (t) => {
  const reviewer = await served(REVIEW_SKILL_NAME)
  const reviewerBody = await vendoredBody(REVIEW_SKILL_NAME)
  assert.equal(reviewer.content, reviewerBody, 'the reviewer body must not move at all')

  const research = await served(DEEP_RESEARCH_SKILL_NAME)
  const researchBody = await vendoredBody(DEEP_RESEARCH_SKILL_NAME)
  // deep-research keeps exactly the append notice added in t14, and nothing else.
  assert.equal(research.content.startsWith(researchBody), true)
  const notice = research.content.slice(researchBody.length)
  assert.equal(notice.includes(PORT_NOTICE_BEGIN), true)
  assert.equal(notice.includes(PORT_NOTICE_END), true)
  assert.equal(notice.includes(WRITE_POLICY_BEGIN), false)
  assert.equal(research.content.split(PORT_NOTICE_BEGIN).length, 2, 'exactly one append notice')

  const paper = await served(PAPER_SKILL_NAME)
  const paperBody = await vendoredBody(PAPER_SKILL_NAME)
  const block = renderWritePolicyBlock(PAPER_SKILL_NAME)

  const paperBytes = Buffer.byteLength(paper.content, 'utf8')
  const paperBodyBytes = Buffer.byteLength(paperBody, 'utf8')
  const blockBytes = Buffer.byteLength(block, 'utf8')
  t.diagnostic('served bytes  academic-paper: ' + paperBytes
    + ' (vendored body ' + paperBodyBytes + ' + block ' + blockBytes
    + ' + t14 append notice ' + (paperBytes - paperBodyBytes - blockBytes) + ')')
  t.diagnostic('served bytes  academic-paper-reviewer: ' + Buffer.byteLength(reviewer.content, 'utf8')
    + ' (vendored body ' + Buffer.byteLength(reviewerBody, 'utf8') + ', unchanged)')
  t.diagnostic('served bytes  deep-research: ' + Buffer.byteLength(research.content, 'utf8')
    + ' (vendored body ' + Buffer.byteLength(researchBody, 'utf8') + ' + t14 append notice ' + Buffer.byteLength(notice, 'utf8') + ')')

  assert.equal(Buffer.byteLength(reviewer.content, 'utf8'), Buffer.byteLength(reviewerBody, 'utf8'))
  assert.equal(Buffer.byteLength(research.content, 'utf8'), Buffer.byteLength(researchBody, 'utf8') + Buffer.byteLength(notice, 'utf8'))
  assert.equal(paper.content, block + paperBody + paper.content.slice(block.length + paperBody.length))
})

test('policy A does not add a tool: the plugin still registers exactly five', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-ar-write-policy-'))
  t.after(async () => { await rm(root, { recursive: true, force: true }) })
  const paper = join(root, 'paper.md')
  await writeFile(paper, '# Paper\n\nWe claim X improves Y by 3 points.\n', 'utf8')

  const ctx = new Context()
  ctx.provide('systemPrompt', { tools: () => () => {}, section: () => () => {} })
  const skills = new SkillRegistry(ctx)
  const tools = new ToolRuntime(ctx)
  plugin.apply(ctx, { stateDir: '.academic-review', workspaceRoot: root })

  assert.deepEqual(tools.schemas().map(schema => schema.name).sort(), [
    'academic_review_confirm',
    'academic_review_create',
    'academic_review_report',
    'academic_review_status',
    'academic_review_submit',
  ])
  // academic-paper is served as a skill only: no academic_paper_* tool exists.
  assert.equal(tools.schemas().some(schema => schema.name.includes('paper') && !schema.name.startsWith('academic_review_')), false)
  const summaries = await skills.list({ cwd: root })
  assert.deepEqual(summaries.map(summary => summary.name).sort(), [PAPER_SKILL_NAME, REVIEW_SKILL_NAME, DEEP_RESEARCH_SKILL_NAME].sort())
  const definition = await skills.get(PAPER_SKILL_NAME, { cwd: root })
  assert.ok(definition !== undefined)
  assert.equal(definition.metadata.writePolicy, WRITE_POLICY_NEW_PATHS_ONLY)
  assert.equal(definition.content.startsWith(WRITE_POLICY_BEGIN), true)
})

test('the detector is not a rubber stamp (synthetic writer and reviewer bodies)', () => {
  // A body that reviews a manuscript: plenty of ".md" mentions, no instruction to
  // produce one. This is the shape of academic-paper-reviewer and deep-research.
  const reviewing = [
    '# Reviewer',
    'Read the manuscript .md file and score it.',
    'The author draft is quoted verbatim; do not change it.',
    ...Array.from({ length: 30 }, (_, index) => '- Check item ' + index + ' against the manuscript .md.'),
  ].join('\n')
  assert.equal(producesFiles(reviewing), false, 'a reviewing body must not be flagged as a writer')

  // A body that tells the model to produce manuscripts: this is academic-paper.
  const writing = [
    '# Writer',
    ...Array.from({ length: FILE_PRODUCING_MIN_WRITING_VERBS + 5 }, (_, index) => 'Write section ' + index + ' of the draft.'),
    ...Array.from({ length: FILE_PRODUCING_MIN_DRAFTING_VERBS + 5 }, (_, index) => 'Revise draft ' + index + '.'),
  ].join('\n')
  assert.equal(producesFiles(writing), true, 'a writing body must be flagged')

  // Both thresholds are load-bearing: dropping either signal clears the flag.
  const writeOnly = Array.from({ length: FILE_PRODUCING_MIN_WRITING_VERBS + 5 }, (_, index) => 'Write ' + index + '.').join('\n')
  assert.equal(producesFiles(writeOnly), false, 'writing verbs alone must not qualify')
  const draftOnly = Array.from({ length: FILE_PRODUCING_MIN_DRAFTING_VERBS + 5 }, (_, index) => 'Draft ' + index + '.').join('\n')
  assert.equal(producesFiles(draftOnly), false, 'drafting verbs alone must not qualify')

  // And the table/rule comparison would catch a fabricated entry in either direction.
  const fakeTable = [...FILE_PRODUCING_SKILLS.map(entry => entry.skill), 'deep-research'].sort()
  const detected = [...FILE_PRODUCING_SKILLS.map(entry => entry.skill)].sort()
  assert.notDeepEqual(fakeTable, detected, 'the bidirectional check must be able to fail')
})
