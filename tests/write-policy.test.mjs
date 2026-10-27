/**
 * Write policy A tests (P3-2, t19 / rule extended for scripts, t29).
 *
 * academic-paper drafts prose; sr-screener produces files by instructing the
 * model to run its own bundled Python. Both must carry policy A, and the rule
 * that decides that must be honest in both directions: a qualifying skill
 * missing from the table fails, a listed skill that stops qualifying fails, and
 * a skill that merely mentions python must stay out.
 *
 * What this DOES NOT prove: that a write cannot happen. The plugin never sees the
 * host's file tools or the vendored scripts it never runs, so policy A is an
 * instruction, not an interlock. These tests check that the instruction is
 * present, first, honest about itself, and travels with exactly the skills that
 * produce files.
 */
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
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
  draftsDocuments,
  fileProducingEntry,
  fileProductionSignals,
  packagedScriptsOf,
  qualifyFileProduction,
  renderWritePolicyBlock,
  runsBundledScripts,
  scriptExecutionSignals,
} from '../lib/write-policy.js'

const repoRoot = fileURLToPath(new URL('..', import.meta.url))
const vendorRoot = defaultVendorBasePath()
const PAPER_SKILL_NAME = 'academic-paper'
const SCREENER_SKILL_NAME = 'sr-screener'

/** Registration control stand-in; the provider only reads it passively. */
function control() {
  return { signal: new AbortController().signal, invalidate: () => {} }
}

/** Provider over the real vendored tree. */
function provider(config = {}) {
  return new VendoredSkillsProvider({ providerName: 'academic-review', ...config }, control())
}

/** The vendored body of one skill, exactly as stored on disk. */
async function vendoredBody(skill, root = vendorRoot) {
  const raw = await readFile(join(root, skill, 'SKILL.md'), 'utf8')
  return parseSkillDocument(raw).body
}

/** Load one served definition by name from a fresh provider. */
async function served(skill) {
  const instance = provider()
  const candidates = await instance.list()
  const candidate = candidates.find(item => item.name === skill)
  assert.ok(candidate !== undefined, 'skill not served: ' + skill)
  const definition = await instance.get(candidate, {})
  assert.ok(definition !== undefined)
  return definition
}

/** Qualify one vendored skill with the real rule. */
async function qualifies(skill, root = vendorRoot) {
  return qualifyFileProduction({
    skillName: skill,
    body: await vendoredBody(skill, root),
    skillDirectory: join(root, skill),
  })
}

/** Build a throwaway skill directory: SKILL.md plus any files given. */
async function fixture(body, files = {}) {
  const root = await mkdtemp(join(tmpdir(), 'dsh-ar-write-rule-'))
  const skillDir = join(root, 'fixture-skill')
  await mkdir(skillDir, { recursive: true })
  for (const [name, content] of Object.entries(files)) {
    const target = join(skillDir, name)
    await mkdir(join(target, '..'), { recursive: true })
    await writeFile(target, content, 'utf8')
  }
  await writeFile(join(skillDir, 'SKILL.md'), body, 'utf8')
  return { root, skillDir, cleanup: async () => { await rm(root, { recursive: true, force: true }) } }
}

test('the table names exactly the vendored skills that qualify (both directions)', async (t) => {
  const vendored = discoverVendoredSkills(vendorRoot)
  assert.ok(vendored.length >= 4, 'expected the four vendored skills, got ' + vendored.join(', '))

  const measured = []
  for (const skill of vendored) {
    const qualification = await qualifies(skill)
    measured.push(qualification)
    t.diagnostic(qualification.verdict)
  }

  const detected = new Set(measured.filter(entry => entry.qualifies).map(entry => entry.skill))
  const tabulated = new Set(FILE_PRODUCING_SKILLS.map(entry => entry.skill))

  // Direction 1: the rule found a producer the table forgot to list.
  for (const entry of measured) {
    if (!entry.qualifies) continue
    assert.equal(tabulated.has(entry.skill), true,
      entry.skill + ' qualifies as file-producing (' + entry.verdict + ') but is missing from FILE_PRODUCING_SKILLS')
  }
  // Direction 2: the table lists a skill that no longer qualifies.
  for (const entry of FILE_PRODUCING_SKILLS) {
    assert.equal(vendored.includes(entry.skill), true, 'FILE_PRODUCING_SKILLS names ' + entry.skill + ', which is not vendored')
    const qualification = measured.find(item => item.skill === entry.skill)
    assert.ok(qualification !== undefined)
    assert.equal(qualification.qualifies, true,
      'FILE_PRODUCING_SKILLS lists ' + entry.skill + ' but it no longer qualifies (' + qualification.verdict + ')')
    // The recorded basis must be one the rule actually measured.
    assert.equal(qualification.bases.includes(entry.basis), true,
      entry.skill + ' is tabulated as ' + entry.basis + ' but the rule measured ' + JSON.stringify(qualification.bases))
  }
  assert.deepEqual([...tabulated].sort(), [...detected].sort())

  // The two skills qualify for DIFFERENT reasons, which is the whole point of
  // having two instruments. If this ever collapses to one basis, the rule has
  // regressed to verb counting.
  const bases = new Map(FILE_PRODUCING_SKILLS.map(entry => [entry.skill, entry.basis]))
  assert.equal(bases.get(PAPER_SKILL_NAME), 'prose-drafting')
  assert.equal(bases.get(SCREENER_SKILL_NAME), 'bundled-script')
  const screener = measured.find(entry => entry.skill === SCREENER_SKILL_NAME)
  assert.equal(screener.prose.draftsDocuments, false, 'sr-screener must NOT qualify on prose verbs')
  assert.equal(screener.scripts.writesViaScripts, true)
  assert.ok(screener.scripts.writingInvocations.length > 0)
  const paper = measured.find(entry => entry.skill === PAPER_SKILL_NAME)
  assert.equal(paper.prose.draftsDocuments, true)
  assert.equal(paper.scripts.writesViaScripts, false, 'academic-paper ships no script it is told to run')

  // Neither non-producer may be dragged in, and each for its own reason.
  for (const skill of [REVIEW_SKILL_NAME, DEEP_RESEARCH_SKILL_NAME]) {
    const entry = measured.find(item => item.skill === skill)
    assert.equal(entry.qualifies, false, skill + ' must not qualify')
    assert.equal(entry.prose.writingVerbs < FILE_PRODUCING_MIN_WRITING_VERBS, true, skill + ' writing verbs')
    assert.equal(entry.prose.draftingVerbs < FILE_PRODUCING_MIN_DRAFTING_VERBS, true, skill + ' drafting verbs')
    assert.equal(entry.scripts.packagedScripts.length, 0, skill + ' ships no scripts')
  }
  // The reviewer DOES instruct python - on scripts this port does not ship - and
  // that must not qualify it. This is the shape rule 2 must refuse.
  const reviewerBody = await vendoredBody(REVIEW_SKILL_NAME)
  assert.match(reviewerBody, /python3?\s+scripts\//u, 'expected the reviewer to name python invocations')
  assert.equal(runsBundledScripts(reviewerBody, join(vendorRoot, REVIEW_SKILL_NAME)), false,
    'invoking a script this port does not ship must not qualify a skill')
})

test('every table entry carries a one-line justification with no typed measurements', () => {
  assert.ok(FILE_PRODUCING_SKILLS.length >= 2)
  for (const entry of FILE_PRODUCING_SKILLS) {
    assert.equal(typeof entry.reason, 'string')
    assert.ok(entry.reason.trim().length > 40, entry.skill + ' reason is too short to be a justification')
    assert.equal(entry.reason.includes('\n'), false, entry.skill + ' reason must be one line')
    assert.ok(entry.reason.length <= 220, entry.skill + ' reason must stay one line at normal widths')
    assert.equal(fileProducingEntry(entry.skill)?.skill, entry.skill)
    // A justification explains WHY the skill qualifies. It never quotes a count:
    // a typed measurement contradicts the code the moment a vendored body or a
    // threshold moves, and this exact defect cost the round twice already.
    assert.equal(/\d/u.test(entry.reason), false,
      entry.skill + ' reason contains a number (' + JSON.stringify(entry.reason) + '); describe why it qualifies instead')
    assert.equal(/\bverb|mention|occurrence|count\b/iu.test(entry.reason), false,
      entry.skill + ' reason talks about measurements instead of the reason')
  }
  // The two reasons are different in kind, not copies of each other.
  assert.notEqual(FILE_PRODUCING_SKILLS[0].reason, FILE_PRODUCING_SKILLS[1].reason)
  assert.equal(fileProducingEntry(REVIEW_SKILL_NAME), undefined)
  assert.equal(fileProducingEntry(DEEP_RESEARCH_SKILL_NAME), undefined)
})

test('the script rule refuses every shape that is not an instruction to run a writing script', async (t) => {
  // 1. The word python in a glossary. Mentioning an interpreter is not running one.
  const glossary = await fixture([
    '---', 'name: fixture-skill', 'description: "Glossary fixture."', '---',
    '# Glossary', '', 'Terms:', '- python: the interpreter the upstream pipeline is written in',
    '- draft: a manuscript draft, quoted for reference only', '',
  ].join('\n'), { 'scripts/tool.py': 'print(1)\n' })
  t.after(glossary.cleanup)
  assert.equal(runsBundledScripts(await vendoredBody('fixture-skill', glossary.root), glossary.skillDir), false,
    'a glossary mention of python must not qualify')
  assert.equal(packagedScriptsOf(glossary.skillDir).length, 1, 'the fixture ships the script, so the shape is right')

  // 2. A skill that SHIPS scripts and never tells the model to run them.
  const unrun = await fixture([
    '---', 'name: fixture-skill', 'description: "Ships helpers."', '---',
    '# Helpers', '', 'This skill ships scripts/tool.py for the maintainers; you never run it.',
    'Read scripts/tool.py if you want to know how the export parser works.', '',
  ].join('\n'), { 'scripts/tool.py': 'print(1)\n' })
  t.after(unrun.cleanup)
  assert.equal(packagedScriptsOf(unrun.skillDir).length, 1, 'the fixture must ship the script')
  assert.equal(runsBundledScripts(await vendoredBody('fixture-skill', unrun.root), unrun.skillDir), false,
    'shipping a script without instructing execution must not qualify')

  // 3. An invocation of a shipped script with only read-side arguments.
  const readOnly = await fixture([
    '---', 'name: fixture-skill', 'description: "Reads."', '---',
    '# Read only', '', 'Run: python scripts/tool.py --inputs exports/ --config screening.json', '',
  ].join('\n'), { 'scripts/tool.py': 'print(1)\n' })
  t.after(readOnly.cleanup)
  assert.equal(runsBundledScripts(await vendoredBody('fixture-skill', readOnly.root), readOnly.skillDir), false,
    'a read-only invocation must not qualify')

  // 4. An output argument on a script this package does not ship.
  const notShipped = await fixture([
    '---', 'name: fixture-skill', 'description: "Names a script it does not ship."', '---',
    '# External', '', 'Run: python3 scripts/hidden_tool.py --manuscript paper.md --out-dir work', '',
  ].join('\n'), { 'scripts/tool.py': 'print(1)\n' })
  t.after(notShipped.cleanup)
  assert.equal(runsBundledScripts(await vendoredBody('fixture-skill', notShipped.root), notShipped.skillDir), false,
    'an output argument on a script we do not ship must not qualify')

  // 5. The positive shape: a shipped script invoked with an output argument,
  //    once through the $S/ form the real skill uses and once bare.
  const writes = await fixture([
    '---', 'name: fixture-skill', 'description: "Writes."', '---',
    '# Writes', '',
    'Run: python $S/tool.py --work workdir --out Screening_TA --config screening.json',
    'Later: python scripts/tool.py --work workdir --out Other',
    '',
  ].join('\n'), { 'scripts/tool.py': 'print(1)\n' })
  t.after(writes.cleanup)
  const signals = scriptExecutionSignals(await vendoredBody('fixture-skill', writes.root), writes.skillDir)
  assert.equal(signals.writesViaScripts, true, 'a shipped script invoked with --out must qualify')
  assert.equal(signals.packagedInvocations, 2)
  assert.deepEqual(signals.writingInvocations, ['scripts/tool.py'])
  assert.equal(runsBundledScripts('# nothing\n', writes.skillDir), false)
})

/**
 * The properties the served block must always have. Kept as a predicate rather
 * than inline asserts so the mutation tests below can prove it actually rejects
 * a block that has lost one of them.
 */
function blockProblems(block) {
  const problems = []
  if (!block.startsWith(WRITE_POLICY_BEGIN)) problems.push('missing opening marker')
  if (!block.includes(WRITE_POLICY_END)) problems.push('missing closing marker')
  const rules = block.slice(WRITE_POLICY_BEGIN.length, block.indexOf(WRITE_POLICY_END))
  // The honesty sentence, word for word: it must never be softened or dropped.
  if (!/cannot enforce/iu.test(rules)) problems.push('lost the cannot-enforce sentence')
  if (!/never sees your file tools/iu.test(rules)) problems.push('lost the never-sees-your-file-tools clause')
  if (!/not upstream text/iu.test(rules)) problems.push('no longer says it is not upstream text')
  // The shape-agnostic rule.
  if (!/existing file/iu.test(rules)) problems.push('lost the never-overwrite rule')
  if (!/new path/iu.test(rules)) problems.push('lost the new-path rule')
  if (!/tell the user/iu.test(rules)) problems.push('lost the tell-the-user rule')
  // The bundled-script sentence: for a step like 'run build_outputs.py --out X' the
  // risk is WHICH paths the command writes, so the block has to name them.
  if (!/bundled script/iu.test(rules)) problems.push('lost the bundled-script sentence')
  if (!/--out/iu.test(rules)) problems.push('the bundled-script sentence no longer names an output argument')
  if (!/work dir/iu.test(rules)) problems.push('the bundled-script sentence no longer names the work dir')
  if (!/(log|workbook)/iu.test(rules)) problems.push('the bundled-script sentence no longer names a log or workbook')
  // No drafting-only vocabulary: the block serves a script-running skill too.
  for (const draftingOnly of ['draft', 'manuscript', 'chapter', 'prose', 'section']) {
    if (rules.toLowerCase().includes(draftingOnly)) problems.push('drafting-only vocabulary: ' + draftingOnly)
  }
  const nonEmpty = block.split('\n').filter(line => line.length > 0)
  if (nonEmpty.length > 14) problems.push('too long: ' + String(nonEmpty.length) + ' non-empty lines')
  return problems
}

test('the block is truthful for both shapes, names the script shape, and is identical for both', async () => {
  const block = renderWritePolicyBlock(PAPER_SKILL_NAME)
  assert.equal(block, renderWritePolicyBlock(SCREENER_SKILL_NAME), 'one block, not one per shape')
  assert.deepEqual(blockProblems(block), [], 'the served block is malformed: ' + blockProblems(block).join('; '))

  // It stays short enough to be a header, not a second document.
  const blockLines = block.split('\n')
  const nonEmpty = blockLines.filter(line => line.length > 0)
  assert.ok(nonEmpty.length <= 14, 'block has ' + String(nonEmpty.length) + ' non-empty lines')
  assert.equal(blockLines[0], WRITE_POLICY_BEGIN)
  assert.equal(blockLines[blockLines.length - 3], WRITE_POLICY_END)

  // The script rule sits directly after the artefact rule, in that order, because
  // it narrows it for the command the model is about to run.
  const artefactAt = block.indexOf('Every artefact you produce')
  const scriptAt = block.indexOf('Every file a bundled script writes')
  assert.ok(artefactAt > 0 && scriptAt > artefactAt, 'the bundled-script rule must follow the artefact rule')
  assert.ok(block.indexOf('choose a new name') > scriptAt, 'the choose-a-new-name rule comes after both')

  // MUTATION 1: drop the script sentence -> the guard must reject it.
  const withoutScript = blockLines.filter(line => !line.includes('bundled script') && !line.includes('log or workbook')).join('\n')
  assert.notEqual(withoutScript, block, 'the mutation must actually change the block')
  assert.equal(blockProblems(withoutScript).includes('lost the bundled-script sentence'), true,
    'the guard must fail when the script sentence is removed')

  // MUTATION 2: reintroduce drafting-only wording -> rejected.
  const withDrafting = block.replace('Every artefact you produce', 'Every draft you produce')
  assert.equal(blockProblems(withDrafting).some(problem => problem.includes('drafting-only vocabulary')), true,
    'the guard must fail when the block drifts into drafting-only language')

  // MUTATION 3: soften the honesty sentence -> rejected.
  const softened = block.replace('the plugin cannot enforce', 'the plugin enforces')
  assert.equal(blockProblems(softened).includes('lost the cannot-enforce sentence'), true,
    'the guard must fail when the honesty sentence is softened')

  // Prepended for both skills, exactly once each, body verbatim after it.
  for (const skill of [PAPER_SKILL_NAME, SCREENER_SKILL_NAME]) {
    const definition = await served(skill)
    const body = await vendoredBody(skill)
    assert.equal(definition.content.startsWith(WRITE_POLICY_BEGIN), true, skill + ' must read the rule first')
    assert.equal(definition.content.split(WRITE_POLICY_BEGIN).length, 2, skill + ' must carry exactly one block')
    assert.equal(definition.content.indexOf(body), block.length, skill + ' vendored body must follow the block')
  }
})

test('write policy is mirrored in metadata for both producers, and only them', async () => {
  for (const skill of [PAPER_SKILL_NAME, SCREENER_SKILL_NAME]) {
    const definition = await served(skill)
    assert.equal(definition.metadata.writePolicy, WRITE_POLICY_NEW_PATHS_ONLY, skill)
    assert.equal(definition.metadata.writePolicyEnforced, false, skill)
  }
  for (const skill of [REVIEW_SKILL_NAME, DEEP_RESEARCH_SKILL_NAME]) {
    const definition = await served(skill)
    assert.equal(definition.metadata.writePolicy, undefined, skill + ' must not advertise a write policy')
    assert.equal(definition.metadata.writePolicyEnforced, undefined)
    assert.equal(definition.content.includes(WRITE_POLICY_BEGIN), false, skill + ' must not carry the block')
  }
  assert.equal(renderWritePolicyBlock(REVIEW_SKILL_NAME), '')
  assert.equal(renderWritePolicyBlock(DEEP_RESEARCH_SKILL_NAME), '')
  assert.equal(renderWritePolicyBlock('not-a-skill'), '')
})

test('served bytes: the three older payloads do not move, sr-screener gains the block', async (t) => {
  const reviewer = await served(REVIEW_SKILL_NAME)
  const reviewerBody = await vendoredBody(REVIEW_SKILL_NAME)
  assert.equal(reviewer.content, reviewerBody, 'the reviewer body must not move at all')

  const research = await served(DEEP_RESEARCH_SKILL_NAME)
  const researchBody = await vendoredBody(DEEP_RESEARCH_SKILL_NAME)
  assert.equal(research.content.startsWith(researchBody), true)
  const researchNotice = research.content.slice(researchBody.length)
  assert.equal(researchNotice.includes(PORT_NOTICE_BEGIN), true)
  assert.equal(research.content.includes(WRITE_POLICY_BEGIN), false)

  const paper = await served(PAPER_SKILL_NAME)
  const paperBody = await vendoredBody(PAPER_SKILL_NAME)
  const block = renderWritePolicyBlock(PAPER_SKILL_NAME)
  const paperNotice = paper.content.slice(block.length + paperBody.length)

  const screener = await served(SCREENER_SKILL_NAME)
  const screenerBody = await vendoredBody(SCREENER_SKILL_NAME)
  const screenerNotice = screener.content.slice(block.length + screenerBody.length)

  const bytes = value => Buffer.byteLength(value, 'utf8')
  t.diagnostic('served bytes  ' + PAPER_SKILL_NAME + ': ' + String(bytes(paper.content))
    + ' = body ' + String(bytes(paperBody)) + ' + block ' + String(bytes(block))
    + ' + notice ' + String(bytes(paperNotice)))
  t.diagnostic('served bytes  ' + REVIEW_SKILL_NAME + ': ' + String(bytes(reviewer.content))
    + ' = body ' + String(bytes(reviewerBody)) + ' (no block, no notice)')
  t.diagnostic('served bytes  ' + DEEP_RESEARCH_SKILL_NAME + ': ' + String(bytes(research.content))
    + ' = body ' + String(bytes(researchBody)) + ' + notice ' + String(bytes(researchNotice)))
  t.diagnostic('served bytes  ' + SCREENER_SKILL_NAME + ': ' + String(bytes(screener.content))
    + ' = body ' + String(bytes(screenerBody)) + ' + block ' + String(bytes(block))
    + ' + notice ' + String(bytes(screenerNotice)) + ' (its own tree is reference-clean)')

  // The three payloads that existed before the rule changed are pinned: fixing
  // the rule is not allowed to move their bytes.
  assert.equal(bytes(reviewer.content), 47300, 'the reviewer served payload moved')
  assert.equal(bytes(research.content), 51632, 'the deep-research served payload moved')
  assert.equal(bytes(paper.content), 65113, 'the academic-paper served payload moved')
  // sr-screener gains the head and, on this tree, no notice of its own.
  assert.equal(bytes(block), 684)
  assert.equal(bytes(screenerNotice), 0)
  // One block, so both carriers gain the same bytes: their payload is exactly
  // body + the same block + their own notice.
  assert.equal(renderWritePolicyBlock(SCREENER_SKILL_NAME), block)
  assert.equal(bytes(paper.content), bytes(paperBody) + bytes(block) + bytes(paperNotice))
  assert.equal(bytes(screener.content), bytes(screenerBody) + bytes(block) + bytes(screenerNotice))
  assert.equal(bytes(screener.content), 33212)
  assert.equal(screener.content.startsWith(block + screenerBody), true)
})

test('the rule adds no tool: the plugin still registers exactly five', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-ar-write-policy-mount-'))
  t.after(async () => { await rm(root, { recursive: true, force: true }) })
  await writeFile(join(root, 'paper.md'), '# Paper\n\nWe claim X improves Y by 3 points.\n', 'utf8')

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
  const summaries = await skills.list({ cwd: root })
  assert.deepEqual(summaries.map(summary => summary.name).sort(),
    [PAPER_SKILL_NAME, REVIEW_SKILL_NAME, DEEP_RESEARCH_SKILL_NAME, SCREENER_SKILL_NAME].sort())
  // sr-screener is served as a skill; no screening tool was added for it.
  assert.equal(tools.schemas().some(schema => schema.name.includes('screen')), false)
  const definition = await skills.get(SCREENER_SKILL_NAME, { cwd: root })
  assert.ok(definition !== undefined)
  assert.equal(definition.metadata.writePolicy, WRITE_POLICY_NEW_PATHS_ONLY)
  assert.equal(definition.content.startsWith(WRITE_POLICY_BEGIN), true)
})

test('the prose rule is not a rubber stamp (synthetic writer and reviewer bodies)', () => {
  const reviewing = [
    '# Reviewer',
    'Read the manuscript .md file and score it.',
    'The author draft is quoted verbatim; do not change it.',
    ...Array.from({ length: 30 }, (_, index) => '- Check item ' + String(index) + ' against the manuscript .md.'),
  ].join('\n')
  assert.equal(draftsDocuments(reviewing), false, 'a reviewing body must not be flagged as a drafter')

  const writing = [
    '# Writer',
    ...Array.from({ length: FILE_PRODUCING_MIN_WRITING_VERBS + 5 }, (_, index) => 'Write section ' + String(index) + ' of the draft.'),
    ...Array.from({ length: FILE_PRODUCING_MIN_DRAFTING_VERBS + 5 }, (_, index) => 'Revise draft ' + String(index) + '.'),
  ].join('\n')
  assert.equal(draftsDocuments(writing), true, 'a drafting body must be flagged')

  const writeOnly = Array.from({ length: FILE_PRODUCING_MIN_WRITING_VERBS + 5 }, (_, index) => 'Write ' + String(index) + '.').join('\n')
  assert.equal(draftsDocuments(writeOnly), false, 'writing verbs alone must not qualify')
  const draftOnly = Array.from({ length: FILE_PRODUCING_MIN_DRAFTING_VERBS + 5 }, (_, index) => 'Draft ' + String(index) + '.').join('\n')
  assert.equal(draftsDocuments(draftOnly), false, 'drafting verbs alone must not qualify')

  // And the table/rule comparison would catch a fabricated entry in either direction.
  const fakeTable = [...FILE_PRODUCING_SKILLS.map(entry => entry.skill), DEEP_RESEARCH_SKILL_NAME].sort()
  const detected = [...FILE_PRODUCING_SKILLS.map(entry => entry.skill)].sort()
  assert.notDeepEqual(fakeTable, detected, 'the bidirectional check must be able to fail')
})

test('no measurement is typed into the write-policy source (the live counts are printed, not stored)', async (t) => {
  const source = await readFile(join(repoRoot, 'src', 'write-policy.ts'), 'utf8')
  assert.deepEqual(source.match(/\d+\s*(?:writing|drafting)\b/giu) ?? [], [],
    'a measured verb count is typed into src/write-policy.ts; compute it with fileProductionSignals() instead')
  assert.deepEqual(source.match(/\d+\s*"\.md"\s*mentions/giu) ?? [], [],
    'a measured .md count is typed into src/write-policy.ts')
  const tableBlock = source.slice(source.indexOf('FILE_PRODUCING_SKILLS: readonly'), source.indexOf('Measurement of one skill body'))
  assert.deepEqual(tableBlock.match(/\d/gu) ?? [], [], 'the table must carry no digits at all')

  // The record of the measurements is the test output, recomputed on every run.
  for (const skill of discoverVendoredSkills(vendorRoot)) {
    t.diagnostic((await qualifies(skill)).verdict)
  }
  const paper = fileProductionSignals(await vendoredBody(PAPER_SKILL_NAME))
  assert.equal(paper.draftsDocuments, true)
  assert.ok(paper.writingVerbs >= FILE_PRODUCING_MIN_WRITING_VERBS)
  assert.ok(paper.draftingVerbs >= FILE_PRODUCING_MIN_DRAFTING_VERBS)
})
