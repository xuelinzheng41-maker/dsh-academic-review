/**
 * Write policy A tests.
 *
 * THE SERVING RULE IS UNCONDITIONAL: every served skill gets the 684-byte block.
 * The detector and the FILE_PRODUCING_SKILLS table survive as DOCUMENTATION of which
 * vendored skills are demonstrated producers and by which instrument - they gate
 * nothing. The reason is recorded in src/write-policy.ts and re-proved here: the
 * qa-gate adversarial pass found three shapes that write and that no instrument
 * detects, and a table/rule consistency test cannot see a shared blind spot.
 *
 * So the load-bearing test in this file is the definitional one - the renderer
 * returns the block for a name that appears in NO table, and no source file in the
 * serving path can turn it off - rather than 'the skills we measured get a block'.
 * A served skill without the block is what has to be impossible.
 *
 * What this still DOES NOT prove: that a write cannot happen. The plugin never sees
 * the host's file tools or a script it never runs, so policy A is an instruction,
 * not an interlock (writePolicyEnforced: false says so in metadata).
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
  writePolicyMetadataOf,
} from '../lib/write-policy.js'

const repoRoot = fileURLToPath(new URL('..', import.meta.url))
const vendorRoot = defaultVendorBasePath()
const PAPER_SKILL_NAME = 'academic-paper'
const SCREENER_SKILL_NAME = 'sr-screener'
/** A name that appears in no table, used to prove nothing gates the block. */
const UNKNOWN_SKILL_NAME = 'aa-not-a-skill'
/** Every vendored skill, i.e. every skill this package serves. */
const SERVED_SKILLS = [PAPER_SKILL_NAME, REVIEW_SKILL_NAME, DEEP_RESEARCH_SKILL_NAME, SCREENER_SKILL_NAME]

/** Registration control stand-in; the provider only reads it passively. */
function control() {
  return { signal: new AbortController().signal, invalidate: () => {} }
}

/** Provider over a vendor tree, defaulting to the real one. */
function provider(config = {}) {
  return new VendoredSkillsProvider({ providerName: 'academic-review', ...config }, control())
}

/** The vendored body of one skill, exactly as stored on disk. */
async function vendoredBody(skill, root = vendorRoot) {
  const raw = await readFile(join(root, skill, 'SKILL.md'), 'utf8')
  return parseSkillDocument(raw).body
}

/** Load one served definition by name from a fresh provider. */
async function served(skill, config = {}) {
  const instance = provider(config)
  const candidates = await instance.list()
  const candidate = candidates.find(item => item.name === skill)
  assert.ok(candidate !== undefined, 'skill not served: ' + skill)
  const definition = await instance.get(candidate, {})
  assert.ok(definition !== undefined)
  return definition
}

/** Serve a whole tree through the real provider, keyed by served name. */
async function serveAll(root) {
  const instance = provider({ vendorBasePath: root })
  const out = new Map()
  for (const candidate of await instance.list()) {
    const definition = await instance.get(candidate, {})
    assert.ok(definition !== undefined, candidate.name + ' must load')
    out.set(candidate.name, definition)
  }
  return out
}

/** Qualify one vendored skill with the real detector. */
async function qualifies(skill, root = vendorRoot) {
  return qualifyFileProduction({
    skillName: skill,
    body: await vendoredBody(skill, root),
    skillDirectory: join(root, skill),
  })
}

/** Build a throwaway vendor tree: one directory per skill, SKILL.md plus any files. */
async function vendorTree(skills) {
  const root = await mkdtemp(join(tmpdir(), 'dsh-ar-serve-'))
  for (const [name, spec] of Object.entries(skills)) {
    const dir = join(root, name)
    await mkdir(dir, { recursive: true })
    for (const [file, content] of Object.entries(spec.files ?? {})) {
      const target = join(dir, file)
      await mkdir(join(target, '..'), { recursive: true })
      await writeFile(target, content, 'utf8')
    }
    await writeFile(join(dir, 'SKILL.md'), [
      '---',
      'name: ' + name,
      'description: "Adversarial fixture for the write-policy suite."',
      '---',
      '',
    ].join('\n') + spec.body, 'utf8')
  }
  return { root, cleanup: async () => { await rm(root, { recursive: true, force: true }) } }
}

/**
 * The properties the served block must always have, as a predicate so the mutation
 * tests can prove it actually rejects a block that has lost one of them.
 */
function blockProblems(block) {
  const problems = []
  if (typeof block !== 'string') return ['not a string']
  if (!block.startsWith(WRITE_POLICY_BEGIN)) problems.push('missing opening marker')
  if (!block.includes(WRITE_POLICY_END)) problems.push('missing closing marker')
  const rules = block.slice(WRITE_POLICY_BEGIN.length, block.indexOf(WRITE_POLICY_END))
  if (!/cannot enforce/iu.test(rules)) problems.push('lost the cannot-enforce sentence')
  if (!/never sees your file tools/iu.test(rules)) problems.push('lost the never-sees-your-file-tools clause')
  if (!/not upstream text/iu.test(rules)) problems.push('no longer says it is not upstream text')
  if (!/existing file/iu.test(rules)) problems.push('lost the never-overwrite rule')
  if (!/new path/iu.test(rules)) problems.push('lost the new-path rule')
  if (!/tell the user/iu.test(rules)) problems.push('lost the tell-the-user rule')
  if (!/bundled script/iu.test(rules)) problems.push('lost the bundled-script sentence')
  if (!/--out/iu.test(rules)) problems.push('the bundled-script sentence no longer names an output argument')
  if (!/work dir/iu.test(rules)) problems.push('the bundled-script sentence no longer names the work dir')
  if (!/(log|workbook)/iu.test(rules)) problems.push('the bundled-script sentence no longer names a log or workbook')
  for (const draftingOnly of ['draft', 'manuscript', 'chapter', 'prose', 'section']) {
    if (rules.toLowerCase().includes(draftingOnly)) problems.push('drafting-only vocabulary: ' + draftingOnly)
  }
  const nonEmpty = block.split('\n').filter(line => line.length > 0)
  if (nonEmpty.length > 14) problems.push('too long: ' + String(nonEmpty.length) + ' non-empty lines')
  return problems
}

/**
 * Whether one served metadata object is honest about policy A for one skill.
 * The asymmetry is the point: the policy keys are on every skill (the block is on
 * every skill), the basis only where an instrument measured one.
 */
function policyMetadataProblems(metadata, entry, measuredBases) {
  const problems = []
  const advertised = Object.keys(metadata).filter(key => key.startsWith('writePolicy'))
  if (metadata.writePolicy !== WRITE_POLICY_NEW_PATHS_ONLY) problems.push('wrong writePolicy: ' + String(metadata.writePolicy))
  if (metadata.writePolicyEnforced !== false) problems.push('claims enforcement it does not have')
  const allowed = entry === undefined
    ? ['writePolicy', 'writePolicyEnforced']
    : ['writePolicy', 'writePolicyEnforced', 'writePolicyBasis']
  for (const key of allowed) {
    if (!(key in metadata)) problems.push('missing ' + key)
  }
  for (const key of advertised) {
    if (!allowed.includes(key)) problems.push('unexpected key ' + key)
  }
  if (entry === undefined) {
    if ('writePolicyBasis' in metadata) problems.push('states a basis nothing measured')
    return problems
  }
  if (metadata.writePolicyBasis === undefined) problems.push('a measured producer states no basis')
  else if (metadata.writePolicyBasis !== entry.basis) {
    problems.push('basis disagrees with the record: served ' + String(metadata.writePolicyBasis) + ', record ' + entry.basis)
  }
  if (measuredBases !== undefined && !measuredBases.includes(metadata.writePolicyBasis)) {
    problems.push('basis names an instrument the detector did not measure: ' + String(metadata.writePolicyBasis))
  }
  return problems
}

test('the block is attached, not selected: a skill in no table still gets the full 684-byte block', async () => {
  const block = renderWritePolicyBlock()
  // The definitional probe, by the name the gate looks for: 'aa-not-a-skill' appears in
  // no table, and the renderer must still return the whole block. If anything in the
  // renderer consults FILE_PRODUCING_SKILLS, this fails loudly.
  assert.equal(UNKNOWN_SKILL_NAME, 'aa-not-a-skill')
  assert.equal(fileProducingEntry('aa-not-a-skill'), undefined, 'the probe name must not be in any table')
  assert.equal(renderWritePolicyBlock('aa-not-a-skill'), block,
    'the probe aa-not-a-skill must be served the block: the block is attached, not selected')
  assert.equal(Buffer.byteLength(renderWritePolicyBlock('aa-not-a-skill'), 'utf8'), 684,
    'the probe aa-not-a-skill must be served exactly 684 bytes')
  assert.equal(renderWritePolicyBlock('aa-not-a-skill').startsWith(WRITE_POLICY_BEGIN), true)
  assert.deepEqual(blockProblems(block), [], 'the served block is malformed: ' + blockProblems(block).join('; '))
  assert.equal(Buffer.byteLength(block, 'utf8'), 684, 'block bytes')

  const blockLines = block.split('\n')
  const nonEmpty = blockLines.filter(line => line.length > 0)
  assert.ok(nonEmpty.length <= 14, 'block has ' + String(nonEmpty.length) + ' non-empty lines')
  assert.equal(blockLines[0], WRITE_POLICY_BEGIN)
  assert.equal(blockLines[blockLines.length - 3], WRITE_POLICY_END)

  // The script rule sits directly after the artefact rule, because it narrows it for
  // the command the model is about to run.
  const artefactAt = block.indexOf('Every artefact you produce')
  const scriptAt = block.indexOf('Every file a bundled script writes')
  assert.ok(artefactAt > 0 && scriptAt > artefactAt, 'the bundled-script rule must follow the artefact rule')
  assert.ok(block.indexOf('choose a new name') > scriptAt)

  // MUTATION 1: drop the script sentence -> the guard must reject it.
  const withoutScript = blockLines.filter(line => !line.includes('bundled script') && !line.includes('log or workbook')).join('\n')
  assert.notEqual(withoutScript, block)
  assert.equal(blockProblems(withoutScript).includes('lost the bundled-script sentence'), true,
    'the guard must fail when the script sentence is removed')
  // MUTATION 2: drafting-only wording -> rejected.
  assert.equal(blockProblems(block.replace('Every artefact you produce', 'Every draft you produce'))
    .some(problem => problem.includes('drafting-only vocabulary')), true)
  // MUTATION 3: soften the honesty sentence -> rejected.
  assert.equal(blockProblems(block.replace('the plugin cannot enforce', 'the plugin enforces'))
    .includes('lost the cannot-enforce sentence'), true)

  // And the renderer itself is a constant: no source path back to the table.
  const source = await readFile(join(repoRoot, 'src', 'write-policy.ts'), 'utf8')
  const from = source.indexOf('export function renderWritePolicyBlock')
  const rendererBody = source.slice(from, source.indexOf('\n}', from))
  assert.equal(/fileProducingEntry|FILE_PRODUCING_SKILLS/u.test(rendererBody), false,
    'the renderer must not consult the table: the block is a constant')
})

test('every served skill carries the block, exactly once, before its body', async () => {
  const block = renderWritePolicyBlock()
  const blocks = new Map()
  for (const skill of SERVED_SKILLS) {
    const definition = await served(skill)
    const body = await vendoredBody(skill)
    blocks.set(skill, definition.content.slice(0, block.length))
    assert.equal(definition.content.startsWith(WRITE_POLICY_BEGIN), true, skill + ' must read the rule first')
    assert.equal(definition.content.split(WRITE_POLICY_BEGIN).length, 2, skill + ' must carry exactly one block')
    assert.equal(definition.content.indexOf(body), block.length, skill + ' vendored body must follow the block')
    assert.equal(definition.content.slice(0, block.length), block, skill + ' block must be byte-identical')
  }
  assert.equal(new Set(blocks.values()).size, 1, 'one block for every skill, not one per skill')
})

test('served bytes: every skill is body + the one 684-byte block + its own notice', async (t) => {
  const block = renderWritePolicyBlock()
  const expected = new Map([
    [PAPER_SKILL_NAME, 65113],
    [REVIEW_SKILL_NAME, 47984],
    [DEEP_RESEARCH_SKILL_NAME, 52316],
    [SCREENER_SKILL_NAME, 33212],
  ])
  const bytes = value => Buffer.byteLength(value, 'utf8')
  for (const skill of SERVED_SKILLS) {
    const definition = await served(skill)
    const body = await vendoredBody(skill)
    const notice = definition.content.slice(block.length + body.length)
    t.diagnostic('served bytes  ' + skill.padEnd(24) + ' ' + String(bytes(definition.content))
      + ' = body ' + String(bytes(body)) + ' + block ' + String(bytes(block))
      + ' + notice ' + String(bytes(notice)))
    assert.equal(bytes(definition.content), bytes(body) + bytes(block) + bytes(notice), skill + ': payload is body + block + notice')
    assert.equal(bytes(definition.content), expected.get(skill), skill + ' served payload moved')
  }
  // Per-skill deltas, because a summed check can hide one skill missing and another
  // carrying the block twice: 0 / 0 / +684 / +684, never +1368.
  const deltas = new Map()
  for (const skill of SERVED_SKILLS) {
    const definition = await served(skill)
    const body = await vendoredBody(skill)
    deltas.set(skill, bytes(definition.content) - bytes(body))
  }
  t.diagnostic('deltas over body: ' + SERVED_SKILLS.map(skill => skill + ' +' + String(deltas.get(skill))).join(', '))
  assert.equal(deltas.get(PAPER_SKILL_NAME), 684 + 572, 'academic-paper: block + its own notice')
  assert.equal(deltas.get(SCREENER_SKILL_NAME), 684, 'sr-screener: block only')
  assert.equal(deltas.get(REVIEW_SKILL_NAME), 684, 'the reviewer gains the block and nothing else')
  assert.equal(deltas.get(DEEP_RESEARCH_SKILL_NAME), 684 + 563, 'deep-research: block + its own notice')
  for (const [skill, delta] of deltas) {
    assert.notEqual(delta, 1368, skill + ' carries the block twice')
  }
  assert.equal(bytes(block), 684)
  assert.equal(bytes(renderWritePolicyBlock()), 684)
  const research = await served(DEEP_RESEARCH_SKILL_NAME)
  assert.equal(research.content.includes(PORT_NOTICE_BEGIN), true, 'deep-research keeps its own notice after the block')
  const reviewer = await served(REVIEW_SKILL_NAME)
  assert.equal(reviewer.content.endsWith(await vendoredBody(REVIEW_SKILL_NAME)), true,
    'the reviewer body must still be byte-identical, now preceded by the block')
})

test('metadata: the rule is on every skill, the measured basis only where it was measured', async (t) => {
  const measured = new Map([
    [PAPER_SKILL_NAME, 'prose-drafting'],
    [SCREENER_SKILL_NAME, 'bundled-script'],
  ])
  for (const skill of SERVED_SKILLS) {
    const definition = await served(skill)
    const entry = fileProducingEntry(skill)
    const qualification = await qualifies(skill)
    t.diagnostic(skill.padEnd(24) + ' metadata ' + JSON.stringify({
      writePolicy: definition.metadata.writePolicy,
      writePolicyEnforced: definition.metadata.writePolicyEnforced,
      writePolicyBasis: definition.metadata.writePolicyBasis ?? null,
    }) + '  detected=' + JSON.stringify(qualification.bases))

    // The two policy keys are unconditional, because the block is.
    assert.equal(definition.metadata.writePolicy, WRITE_POLICY_NEW_PATHS_ONLY, skill)
    assert.equal(definition.metadata.writePolicyEnforced, false, skill)
    assert.deepEqual(
      policyMetadataProblems(definition.metadata, entry, qualification.bases), [],
      skill + ' advertises policy A dishonestly: '
        + policyMetadataProblems(definition.metadata, entry, qualification.bases).join('; '))

    if (measured.has(skill)) {
      assert.equal(definition.metadata.writePolicyBasis, measured.get(skill), skill + ' basis')
      assert.equal(definition.metadata.writePolicyBasis, entry?.basis, skill + ': served basis is the recorded basis')
      assert.equal(qualification.bases.includes(definition.metadata.writePolicyBasis), true,
        skill + ' basis must be an instrument the detector measured')
    } else {
      // Deliberate asymmetry: absent, not null, and not invented.
      assert.equal('writePolicyBasis' in definition.metadata, false,
        skill + ' must not state a basis: nothing measured one')
      assert.equal(definition.metadata.writePolicyBasis ?? null, null, skill)
      assert.equal(entry, undefined, skill + ' must not be in the record either')
    }
  }
  // The two producers state DIFFERENT instruments - the reason the key exists.
  assert.notEqual((await served(PAPER_SKILL_NAME)).metadata.writePolicyBasis,
    (await served(SCREENER_SKILL_NAME)).metadata.writePolicyBasis)

  // The module-level function agrees with what is served, for every name.
  for (const skill of [...SERVED_SKILLS, UNKNOWN_SKILL_NAME]) {
    const declared = writePolicyMetadataOf(skill)
    if (SERVED_SKILLS.includes(skill)) {
      const definition = await served(skill)
      for (const key of Object.keys(declared)) {
        assert.equal(definition.metadata[key], declared[key], skill + ' metadata must mirror writePolicyMetadataOf')
      }
    }
  }
  assert.deepEqual(writePolicyMetadataOf(UNKNOWN_SKILL_NAME),
    { writePolicy: WRITE_POLICY_NEW_PATHS_ONLY, writePolicyEnforced: false })

  // MUTATION 1: a skill nothing measured that states a basis -> rejected.
  const honestUnmeasured = { writePolicy: WRITE_POLICY_NEW_PATHS_ONLY, writePolicyEnforced: false }
  const honestMeasured = { ...honestUnmeasured, writePolicyBasis: 'bundled-script' }
  const entry = fileProducingEntry(SCREENER_SKILL_NAME)
  assert.deepEqual(policyMetadataProblems(honestUnmeasured, undefined), [])
  assert.deepEqual(policyMetadataProblems(honestMeasured, entry, ['bundled-script']), [])
  assert.equal(policyMetadataProblems({ ...honestUnmeasured, writePolicyBasis: 'prose-drafting' }, undefined)
    .includes('states a basis nothing measured'), true,
    'inventing a basis for an unmeasured skill must fail the suite')
  // MUTATION 2: a measured producer that drops its basis -> rejected.
  assert.equal(policyMetadataProblems(honestUnmeasured, entry, ['bundled-script'])
    .includes('a measured producer states no basis'), true)
  // MUTATION 3: a basis that disagrees with the record -> rejected.
  assert.equal(policyMetadataProblems({ ...honestMeasured, writePolicyBasis: 'prose-drafting' }, entry, ['prose-drafting', 'bundled-script'])
    .some(problem => problem.startsWith('basis disagrees with the record')), true)
  // MUTATION 4: a basis the detector never measured -> rejected.
  assert.equal(policyMetadataProblems(honestMeasured, entry, ['prose-drafting'])
    .some(problem => problem.startsWith('basis names an instrument the detector did not measure')), true)
  // MUTATION 5: the policy keys cannot go missing, and enforcement cannot flip.
  assert.equal(policyMetadataProblems({ writePolicyEnforced: false }, undefined).includes('missing writePolicy'), true,
    'the policy key is unconditional, so its absence must fail')
  assert.equal(policyMetadataProblems({ ...honestUnmeasured, writePolicyEnforced: true }, undefined)
    .includes('claims enforcement it does not have'), true)
})

test('the adversarial shapes no instrument detects are still served the block', async (t) => {
  // qa-gate's three false negatives, reproduced as fixtures. Each one writes files and
  // each is invisible to the detector - which is exactly why serving cannot depend on
  // the detector. The assertion is that the block arrives anyway.
  const tree = await vendorTree({
    'shell-writer': {
      body: '# Inventory\n\nRun: mkdir -p exports && ls vendor > out/inventory.md\n',
    },
    'inline-python-writer': {
      body: '# Inline\n\nRun: python -c "import pathlib; pathlib.Path(\'out/rows.csv\').write_text(\'a,b\')"\n',
    },
    'generate-prose-writer': {
      body: '# Deliverable\n\nGenerate the deliverable and produce the artefact in out/.\n'
        + 'Generate the tables, produce the figures, generate the summary.\n',
    },
    'never-writes': {
      body: '# Reader\n\nRead the manuscript and answer questions about it.\n',
    },
  })
  t.after(tree.cleanup)
  const servedTree = await serveAll(tree.root)
  const block = renderWritePolicyBlock()
  assert.equal(servedTree.size, 4, 'every fixture skill must be served')
  for (const [name, definition] of servedTree) {
    const detected = qualifyFileProduction({
      skillName: name,
      body: parseSkillDocument(await readFile(join(tree.root, name, 'SKILL.md'), 'utf8')).body,
      skillDirectory: join(tree.root, name),
    })
    t.diagnostic(name.padEnd(24) + ' detected=' + JSON.stringify(detected.bases)
      + ' block=' + String(Buffer.byteLength(definition.content.slice(0, block.length), 'utf8')) + 'B')
    // The detector's blind spot, recorded: it does not call these producers.
    assert.equal(detected.qualifies, false, name + ' is expected to defeat the detector')
    assert.equal(fileProducingEntry(name), undefined)
    // And it does not matter: the rule is served.
    assert.equal(definition.content.startsWith(block), true, name + ' must be served the block')
    assert.equal(definition.content.split(WRITE_POLICY_BEGIN).length, 2, name)
    assert.equal(definition.metadata.writePolicy, WRITE_POLICY_NEW_PATHS_ONLY, name)
    assert.equal(definition.metadata.writePolicyEnforced, false, name)
    assert.equal('writePolicyBasis' in definition.metadata, false, name + ' must not state a basis')
  }
  // The shell shape is the one the interpreter rule cannot see at all.
  const shellBody = await vendoredBody('shell-writer', tree.root)
  assert.equal(scriptExecutionSignals(shellBody, join(tree.root, 'shell-writer')).writesViaScripts, false)
  assert.equal(draftsDocuments(shellBody), false)
})

test('the record: every vendored producer is tabulated with its instrument (and nothing else is)', async (t) => {
  // This test proves the RECORD matches the detector. It does not prove the detector
  // is right, and it cannot: if the detector misses a skill, the record and the
  // detector agree. Serving no longer depends on either.
  const vendored = discoverVendoredSkills(vendorRoot)
  const measured = []
  for (const skill of vendored) {
    const qualification = await qualifies(skill)
    measured.push(qualification)
    t.diagnostic(qualification.verdict)
  }
  const detected = new Set(measured.filter(entry => entry.qualifies).map(entry => entry.skill))
  const tabulated = new Set(FILE_PRODUCING_SKILLS.map(entry => entry.skill))
  for (const entry of measured) {
    if (!entry.qualifies) continue
    assert.equal(tabulated.has(entry.skill), true,
      entry.skill + ' is a demonstrated producer (' + entry.verdict + ') but is missing from FILE_PRODUCING_SKILLS')
  }
  for (const entry of FILE_PRODUCING_SKILLS) {
    assert.equal(vendored.includes(entry.skill), true, entry.skill + ' is not vendored')
    const qualification = measured.find(item => item.skill === entry.skill)
    assert.equal(qualification.qualifies, true,
      'FILE_PRODUCING_SKILLS lists ' + entry.skill + ' but the detector no longer demonstrates it (' + qualification.verdict + ')')
    assert.equal(qualification.bases.includes(entry.basis), true,
      entry.skill + ' is recorded as ' + entry.basis + ' but the detector measured ' + JSON.stringify(qualification.bases))
  }
  assert.deepEqual([...tabulated].sort(), [...detected].sort())
  const bases = new Map(FILE_PRODUCING_SKILLS.map(entry => [entry.skill, entry.basis]))
  assert.equal(bases.get(PAPER_SKILL_NAME), 'prose-drafting')
  assert.equal(bases.get(SCREENER_SKILL_NAME), 'bundled-script')
  const screener = measured.find(entry => entry.skill === SCREENER_SKILL_NAME)
  assert.equal(screener.prose.draftsDocuments, false, 'sr-screener must NOT be recorded as a prose drafter')
  assert.equal(screener.scripts.writesViaScripts, true)
  const paper = measured.find(entry => entry.skill === PAPER_SKILL_NAME)
  assert.equal(paper.prose.draftsDocuments, true)
  assert.equal(paper.scripts.writesViaScripts, false)
})

test('every record entry carries a one-line justification with no typed measurements', () => {
  assert.ok(FILE_PRODUCING_SKILLS.length >= 2)
  for (const entry of FILE_PRODUCING_SKILLS) {
    assert.ok(entry.reason.trim().length > 40, entry.skill + ' reason is too short to be a justification')
    assert.equal(entry.reason.includes('\n'), false, entry.skill + ' reason must be one line')
    assert.ok(entry.reason.length <= 220, entry.skill + ' reason must stay one line at normal widths')
    assert.equal(/\d/u.test(entry.reason), false,
      entry.skill + ' reason contains a number; describe why instead')
    assert.equal(/\bverb|mention|occurrence|count\b/iu.test(entry.reason), false,
      entry.skill + ' reason talks about measurements instead of the reason')
  }
  assert.notEqual(FILE_PRODUCING_SKILLS[0].reason, FILE_PRODUCING_SKILLS[1].reason)
})

test('the script instrument records only instructions to run a writing script it ships', async (t) => {
  // Documentation of the detector, not of the serving rule: these shapes are refused
  // the RECORD, and (see the adversarial test) still served the block.
  const tree = await vendorTree({
    'glossary': {
      body: '# Glossary\n\nTerms:\n- python: the interpreter the upstream pipeline is written in\n'
        + '- draft: a manuscript draft, quoted for reference only\n',
      files: { 'scripts/tool.py': 'print(1)\n' },
    },
    'ships-but-never-runs': {
      body: '# Helpers\n\nThis skill ships scripts/tool.py for the maintainers; you never run it.\n'
        + 'Read scripts/tool.py if you want to know how the export parser works.\n',
      files: { 'scripts/tool.py': 'print(1)\n' },
    },
    'read-only-arguments': {
      body: '# Read only\n\nRun: python scripts/tool.py --inputs exports/ --config screening.json\n',
      files: { 'scripts/tool.py': 'print(1)\n' },
    },
    'script-not-shipped': {
      body: '# External\n\nRun: python3 scripts/hidden_tool.py --manuscript paper.md --out-dir work\n',
      files: { 'scripts/tool.py': 'print(1)\n' },
    },
    'writes-through-its-own-script': {
      body: '# Writes\n\nRun: python $S/tool.py --work workdir --out Screening_TA --config screening.json\n'
        + 'Later: python scripts/tool.py --work workdir --out Other\n',
      files: { 'scripts/tool.py': 'print(1)\n' },
    },
  })
  t.after(tree.cleanup)
  for (const name of ['glossary', 'ships-but-never-runs', 'read-only-arguments', 'script-not-shipped']) {
    const body = await vendoredBody(name, tree.root)
    assert.equal(runsBundledScripts(body, join(tree.root, name)), false,
      name + ' must not be recorded as running a writing script')
    assert.equal(packagedScriptsOf(join(tree.root, name)).length, 1, name + ' ships the script, so the shape is right')
  }
  const writes = await vendoredBody('writes-through-its-own-script', tree.root)
  const signals = scriptExecutionSignals(writes, join(tree.root, 'writes-through-its-own-script'))
  assert.equal(signals.writesViaScripts, true, 'a shipped script invoked with --out must be recorded')
  assert.equal(signals.packagedInvocations, 2)
  assert.deepEqual(signals.writingInvocations, ['scripts/tool.py'])
  assert.equal(runsBundledScripts('# nothing\n', join(tree.root, 'writes-through-its-own-script')), false)
})

test('the prose instrument is not a rubber stamp', () => {
  const reviewing = [
    '# Reviewer',
    'Read the manuscript .md file and score it.',
    'The author draft is quoted verbatim; do not change it.',
    ...Array.from({ length: 30 }, (_, index) => '- Check item ' + String(index) + ' against the manuscript .md.'),
  ].join('\n')
  assert.equal(draftsDocuments(reviewing), false, 'a reviewing body must not be recorded as a drafter')
  const writing = [
    '# Writer',
    ...Array.from({ length: FILE_PRODUCING_MIN_WRITING_VERBS + 5 }, (_, index) => 'Write section ' + String(index) + ' of the draft.'),
    ...Array.from({ length: FILE_PRODUCING_MIN_DRAFTING_VERBS + 5 }, (_, index) => 'Revise draft ' + String(index) + '.')
  ].join('\n')
  assert.equal(draftsDocuments(writing), true)
  const writeOnly = Array.from({ length: FILE_PRODUCING_MIN_WRITING_VERBS + 5 }, (_, index) => 'Write ' + String(index) + '.').join('\n')
  assert.equal(draftsDocuments(writeOnly), false, 'writing verbs alone must not qualify')
  const draftOnly = Array.from({ length: FILE_PRODUCING_MIN_DRAFTING_VERBS + 5 }, (_, index) => 'Draft ' + String(index) + '.').join('\n')
  assert.equal(draftsDocuments(draftOnly), false, 'drafting verbs alone must not qualify')
})

test('serving the rule to every skill adds no tool and blocks none', async (t) => {
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
  assert.deepEqual(summaries.map(summary => summary.name).sort(), [...SERVED_SKILLS].sort())
  // Every advertised skill is served with the rule in front - checked per skill.
  for (const summary of summaries) {
    const definition = await skills.get(summary.name, { cwd: root })
    assert.ok(definition !== undefined, summary.name + ' must load')
    assert.equal(definition.content.startsWith(WRITE_POLICY_BEGIN), true,
      summary.name + ' must be served with the block first')
    assert.equal(definition.content.split(WRITE_POLICY_BEGIN).length, 2, summary.name + ' must carry one block')
    assert.equal(definition.metadata.writePolicy, WRITE_POLICY_NEW_PATHS_ONLY, summary.name)
    assert.equal(definition.metadata.writePolicyEnforced, false, summary.name)
  }
  assert.equal(tools.schemas().some(schema => schema.name.includes('screen')), false, 'no screening tool')
})

test('no measurement is typed into the write-policy source (counts are printed, not stored)', async (t) => {
  const source = await readFile(join(repoRoot, 'src', 'write-policy.ts'), 'utf8')
  assert.deepEqual(source.match(/\d+\s*(?:writing|drafting)\b/giu) ?? [], [],
    'a measured verb count is typed into src/write-policy.ts; compute it with fileProductionSignals() instead')
  const tableBlock = source.slice(source.indexOf('FILE_PRODUCING_SKILLS: readonly'), source.indexOf('Measurement of one skill body'))
  assert.deepEqual(tableBlock.match(/\d/gu) ?? [], [], 'the record must carry no digits at all')
  // The record is documentation: no serving-path comment may call it a precondition.
  assert.deepEqual(source.match(/(?:carries? (?:the )?polic\w+ because|qualifies for the block|only file-producing skills (?:get|carry))/giu) ?? [], [],
    'the record no longer gates serving, so no comment may describe it as a precondition')
  for (const skill of discoverVendoredSkills(vendorRoot)) {
    t.diagnostic((await qualifies(skill)).verdict)
  }
  const paper = fileProductionSignals(await vendoredBody(PAPER_SKILL_NAME))
  assert.equal(paper.draftsDocuments, true)
  assert.ok(paper.writingVerbs >= FILE_PRODUCING_MIN_WRITING_VERBS)
})
