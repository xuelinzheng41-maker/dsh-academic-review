/**
 * Served-skill port notice tests (P3-1, t14).
 *
 * A prompt-only skill that points at a file the package does not contain teaches the
 * model to improvise, so the provider appends a delimited port notice naming the missing
 * paths and mirrors them in metadata - while a skill with nothing missing is served as
 * block + body and nothing else.
 *
 * Who earns a notice changed in the academic-pipeline round, and both directions are
 * asserted here rather than edited away:
 *   - deep-research was the skill this file was written for. Its one missing reference
 *     (../../academic-pipeline/references/literature_corpus_consumers.md) is now vendored,
 *     so it is served clean, and the file's existence is asserted as the reason.
 *   - academic-pipeline is the only skill with a notice now: four paths its own markdown
 *     names - docs/PERFORMANCE.md, two design specs and scripts/adapters/ - are not
 *     vendored, so those four are what the notice mechanism is exercised on.
 * The notice is a property of the TREE, not of a skill's luck: the same rule produces
 * four entries for one skill and zero for four others, from the same code path.
 */
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import { Context } from '@deepseek-ai/cordis'
import { SkillRegistry } from '@deepseek-ai/dsh-skill'
import {
  DEEP_RESEARCH_SKILL_NAME,
  PORT_NOTICE_BEGIN,
  PORT_NOTICE_END,
  REVIEW_SKILL_NAME,
  VendoredSkillsProvider,
  defaultVendorBasePath,
  parseSkillDocument,
  registerReviewSkillProvider,
  renderPortNotice,
} from '../lib/skills.js'
import {
  existsInside,
  missingReferencesForSkill,
  scanVendorReferences,
} from '../lib/references.js'
import { renderWritePolicyBlock } from '../lib/write-policy.js'

const repoRoot = fileURLToPath(new URL('..', import.meta.url))
const vendorRoot = defaultVendorBasePath()

/** The fifth vendored skill: the only one whose own tree names unvendored paths. */
const PIPELINE_SKILL_NAME = 'academic-pipeline'

/**
 * What academic-pipeline's own markdown names and this port does not ship, measured with
 * the provider's own output. Every other served skill reports zero own-tree misses.
 */
const MISSING_TARGETS = [
  'docs/PERFORMANCE.md',
  'docs/design/2026-04-26-ars-v3.6.5-consumer-integration-design.md',
  'docs/design/2026-04-30-ars-v3.6.7-step-6-orchestrator-hooks-spec.md',
  'scripts/adapters/',
]

/**
 * The shared/ scope, measured: 7 distinct targets, reached through the shared/ files a
 * skill actually references. The docs still claim 11 references across 16 sites from the
 * four-skill tree; this is the number, and the mismatch is reported rather than copied.
 */
const SHARED_SCOPE_TARGETS = 7

/** Registration control stand-in; the provider only reads it passively. */
function control() {
  const controller = new AbortController()
  return { signal: controller.signal, invalidate: () => {} }
}

/** Provider over the real vendored tree. */
function provider(config = {}) {
  return new VendoredSkillsProvider({ providerName: 'academic-review', ...config }, control())
}

/** The vendored body of one skill, exactly as stored. */
async function vendoredBody(skillName) {
  const raw = await readFile(join(vendorRoot, skillName, 'SKILL.md'), 'utf8')
  return parseSkillDocument(raw).body
}

test('academic-pipeline is served with a notice naming the four references this port does not ship', async () => {
  const instance = provider()
  const candidates = await instance.list()
  const candidate = candidates.find(item => item.name === PIPELINE_SKILL_NAME)
  assert.ok(candidate !== undefined, 'academic-pipeline must be advertised')
  const definition = await instance.get(candidate, {})
  const body = await vendoredBody(PIPELINE_SKILL_NAME)
  const block = renderWritePolicyBlock()
  // Since 3f16ec3 the write-policy rule is prepended to every served skill, so the payload
  // is block + body + notice. The body is still served unmodified and the notice is still
  // appended; the parts are located by block.length + body.length rather than by
  // restating a total, so a change to any part shows up as the part that moved.
  assert.ok(definition.content.startsWith(block), 'the write-policy block must be served first')
  assert.equal(definition.content.slice(block.length, block.length + body.length), body,
    'the vendored body must be served unmodified, directly after the block')
  const notice = definition.content.slice(block.length + body.length)
  assert.ok(notice.includes(PORT_NOTICE_BEGIN), 'the notice must open with its marker')
  assert.ok(notice.includes(PORT_NOTICE_END), 'the notice must close with its marker')
  assert.match(notice, /not upstream text/iu)
  assert.match(notice, /do not fabricate or paraphrase/iu)

  // Exactly those four paths, each with the file in THIS tree that names it, and nothing
  // else: one bullet per target, no padding, no other tree's misses.
  const named = [...notice.matchAll(/[\u0060]([^\u0060]+)[\u0060]/gu)].map(match => match[1])
  const bullets = notice.split('\n').filter(line => line.startsWith('- '))
  assert.equal(bullets.length, MISSING_TARGETS.length, 'one bullet per missing target')
  for (const target of MISSING_TARGETS) {
    assert.equal(named.includes(target), true, 'the notice must name ' + target)
  }
  assert.equal(named.filter(name => MISSING_TARGETS.includes(name)).length, MISSING_TARGETS.length,
    'a target must be named once, not repeated')
  for (const source of named) {
    if (MISSING_TARGETS.includes(source)) continue
    // The other backticked names are the referencing files, and they must exist here.
    assert.equal(await existsInside(vendorRoot, PIPELINE_SKILL_NAME + '/' + source), true,
      'a named source must be a file in this skill tree: ' + source)
  }
  assert.equal(notice.includes('academic-paper/references'), false, 'shared-tree misses are not this skill\'s notice')

  // Mirror in metadata for a UI that never parses the body.
  assert.deepEqual(definition.metadata.unavailableReferences, MISSING_TARGETS)
  assert.equal(definition.metadata.unavailableReferenceCount, MISSING_TARGETS.length)

  // Short enough to stay a footnote, not a second document.
  assert.ok(notice.split('\n').length <= 16, 'notice is ' + notice.split('\n').length + ' lines')
})

/**
 * The other half, and the reason this file's subject moved: deep-research used to be the
 * skill that earned a notice. Its one missing reference is vendored now, so the notice is
 * GONE - asserted absent rather than deleted, because a notice that silently returns is a
 * path that stopped resolving, and a test that had simply stopped naming deep-research
 * could not tell the two apart.
 */
test('deep-research earns no notice now, because the one file it named is vendored', async () => {
  const instance = provider()
  const candidates = await instance.list()
  const candidate = candidates.find(item => item.name === DEEP_RESEARCH_SKILL_NAME)
  assert.ok(candidate !== undefined)
  const definition = await instance.get(candidate, {})
  const body = await vendoredBody(DEEP_RESEARCH_SKILL_NAME)
  const block = renderWritePolicyBlock()

  assert.equal(definition.content, block + body, 'deep-research must be served as block + body, with nothing appended')
  assert.equal(definition.content.includes(PORT_NOTICE_BEGIN), false)
  assert.equal(definition.metadata.unavailableReferenceCount, 0)
  assert.deepEqual(definition.metadata.unavailableReferences, [])

  // WHY the absence is correct: the target is in the tree. Without this the assertion above
  // would pass just as happily if the scanner stopped seeing references at all.
  const formerTarget = 'academic-pipeline/references/literature_corpus_consumers.md'
  assert.equal(await existsInside(vendorRoot, formerTarget), true,
    'the notice can only be absent because this file is vendored now')
  assert.ok((await readFile(join(vendorRoot, formerTarget), 'utf8')).length > 0, formerTarget + ' must not be an empty file')
})

test('academic-paper-reviewer is served with no notice and its body is unchanged byte-for-byte', async () => {
  const instance = provider()
  const candidates = await instance.list()
  const candidate = candidates.find(item => item.name === REVIEW_SKILL_NAME)
  const definition = await instance.get(candidate, {})
  const body = await vendoredBody(REVIEW_SKILL_NAME)
  const block = renderWritePolicyBlock()

  // The test's name still describes what it asserts: the reviewer earns NO NOTICE and its
  // BODY is byte-for-byte the vendored text. What changed in t37 is that the rule is now
  // prepended to every served skill, so the payload is block + body; the assertion is
  // re-aimed at the body part rather than loosened, and the byte-length check measures
  // that part instead of the whole payload.
  assert.equal(definition.content, block + body, 'the reviewer payload must be block + body and nothing else')
  assert.equal(definition.content.slice(block.length), body, 'the reviewer body must stay byte-identical to the vendored text')
  assert.equal(definition.content.includes(PORT_NOTICE_BEGIN), false)
  assert.equal(Buffer.byteLength(definition.content.slice(block.length), 'utf8'), Buffer.byteLength(body, 'utf8'))
  assert.equal(definition.metadata.unavailableReferences.length, 0)
  assert.equal(definition.metadata.unavailableReferenceCount, 0)
  assert.equal(renderPortNotice(REVIEW_SKILL_NAME, []), '')

  // New in t15: the shared/ tree this skill reaches DOES name files this port does
  // not ship. That is reported in metadata only - the body assertion above is the
  // proof that surfacing it did not touch a single served byte.
  assert.ok(definition.metadata.unavailableSharedReferenceCount > 0,
    'the reviewer reaches shared/ files that name missing targets; the count must not be silent')
  assert.equal(definition.metadata.unavailableSharedReferences.length, definition.metadata.unavailableSharedReferenceCount)
  assert.equal(new Set(definition.metadata.unavailableSharedReferences).size, definition.metadata.unavailableSharedReferenceCount,
    'the shared list must not repeat a target')
  assert.equal(definition.metadata.unavailableSharedReferences.includes('shared/handoff_schemas.md'), false,
    'the list carries missing targets, not the shared files themselves')
  for (const target of definition.metadata.unavailableSharedReferences) {
    assert.equal(await existsInside(vendorRoot, target), false, target + ' is listed as unavailable but exists')
  }
  // Nothing in the body changed: the notice never carries shared-scope misses.
  assert.equal(definition.content.includes('unavailableSharedReferences'), false)
})

test('the resolver reports a missing target as missing, not as resolved', async () => {
  // Driven on the one tree that has misses now. The path this test used on deep-research
  // (academic-pipeline/references/literature_corpus_consumers.md) is vendored, and the
  // assertions at the end keep that in view: the case moved, it did not weaken.
  const scan = await scanVendorReferences({ vendorBasePath: vendorRoot, skillName: PIPELINE_SKILL_NAME })
  assert.deepEqual(scan.missing.map(entry => entry.target).sort(), MISSING_TARGETS)
  assert.equal(scan.resolved.length + scan.missing.length, scan.references)
  for (const entry of scan.missing) {
    assert.equal(scan.resolved.some(other => other.target === entry.target), false,
      entry.target + ' cannot be both resolved and missing')
    assert.equal(await existsInside(vendorRoot, entry.target), false, entry.target + ' is reported missing but exists')
    // A scan row carries the referencing FILE; the grouped form used below turns that into
    // the sources list, so both shapes are checked rather than assumed to agree.
    assert.equal(entry.exists, false, entry.target + ' is reported missing but the scanner found it')
    assert.equal(typeof entry.file, 'string', entry.target + ' must name what references it')
    assert.equal(entry.file.startsWith(PIPELINE_SKILL_NAME + '/'), true,
      'a miss reported for ' + PIPELINE_SKILL_NAME + ' must come from its own tree, saw ' + entry.file)
  }
  assert.equal(await existsInside(vendorRoot, PIPELINE_SKILL_NAME + '/SKILL.md'), true)

  const missing = await missingReferencesForSkill({ vendorBasePath: vendorRoot, skillName: PIPELINE_SKILL_NAME })
  assert.deepEqual(missing.map(entry => entry.target), MISSING_TARGETS)
  assert.deepEqual(missing[0], {
    target: 'docs/PERFORMANCE.md',
    sources: ['academic-pipeline/references/passport_as_reset_boundary.md'],
  })
  // The two trees whose own references all resolve are clean, so they get no notice...
  assert.deepEqual(await missingReferencesForSkill({ vendorBasePath: vendorRoot, skillName: REVIEW_SKILL_NAME }), [])
  assert.deepEqual(await missingReferencesForSkill({ vendorBasePath: vendorRoot, skillName: DEEP_RESEARCH_SKILL_NAME }), [])
  // ...and the deep-research case resolved for a reason that can be checked.
  assert.equal(await existsInside(vendorRoot, 'academic-pipeline/references/literature_corpus_consumers.md'), true,
    'deep-research is clean because this path is now vendored, not because the scanner stopped looking')
})

test('a reference that escapes the package is reported, never followed or thrown', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-port-notice-'))
  try {
    const skillDir = join(root, 'fixture-skill')
    await mkdir(skillDir, { recursive: true })
    await writeFile(join(skillDir, 'notes.md'), '# Present\n', 'utf8')
    await writeFile(join(skillDir, 'SKILL.md'), [
      '---',
      'name: fixture-skill',
      'description: "Fixture skill with dangling references."',
      'metadata:',
      '  version: "0.0.1"',
      '---',
      '# Fixture',
      '',
      'Read [the report](../../../outside/report.md) and [notes](notes.md).',
      'Also shared/schemas/<domain>/<mode>.json is a placeholder, not a path.',
      '',
    ].join('\n'), 'utf8')

    const instance = new VendoredSkillsProvider(
      { providerName: 'academic-review', vendorBasePath: root },
      control(),
    )
    const [candidate] = await instance.list()
    const definition = await instance.get(candidate, {})
    assert.ok(definition !== undefined)
    assert.match(definition.content, /^# Fixture/mu)
    assert.match(definition.content, /Port notice/u)
    // The escape is named as missing and never resolved onto the real file system.
    // Three ".." from fixture-skill/SKILL.md leaves the vendor base entirely.
    assert.deepEqual(definition.metadata.unavailableReferences, ['../../outside/report.md'])
    assert.equal(await existsInside(root, '../../outside/report.md'), false)
    // The in-tree reference resolves, so the scan is not reporting everything as missing.
    const scan = await scanVendorReferences({ vendorBasePath: root, skillName: 'fixture-skill' })
    assert.equal(scan.resolved.length, 1)
    assert.equal(scan.missing.length, 1)
    assert.equal(scan.placeholders, 1)
    // The fixture reaches no shared/ file at all, so the shared scope is empty.
    assert.deepEqual(definition.metadata.unavailableSharedReferences, [])
    assert.equal(definition.metadata.unavailableSharedReferenceCount, 0)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('a long missing list is truncated in the body and carried in full in metadata', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-port-notice-long-'))
  try {
    const skillDir = join(root, 'long-skill')
    await mkdir(skillDir, { recursive: true })
    const links = Array.from({ length: 9 }, (_, index) => '- [gone ' + index + '](agents/gone_' + index + '.md)')
    await writeFile(join(skillDir, 'SKILL.md'), [
      '---',
      'name: long-skill',
      'description: "Fixture skill with many dangling references."',
      '---',
      '# Long',
      '',
      ...links,
      '',
    ].join('\n'), 'utf8')

    const instance = new VendoredSkillsProvider(
      { providerName: 'academic-review', vendorBasePath: root },
      control(),
    )
    const [candidate] = await instance.list()
    const definition = await instance.get(candidate, {})
    assert.equal(definition.metadata.unavailableReferenceCount, 9)
    assert.equal(definition.metadata.unavailableReferences.length, 9)
    const notice = definition.content.slice(definition.content.indexOf(PORT_NOTICE_BEGIN))
    assert.equal(notice.includes('and 3 more (metadata.unavailableReferences)'), true, notice)
    assert.ok(notice.split('\n').length <= 16, 'notice is ' + notice.split('\n').length + ' lines')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('the mounted provider serves the notice through the host registry', async () => {
  const ctx = new Context()
  const skills = new SkillRegistry(ctx)
  registerReviewSkillProvider(ctx, { providerName: 'academic-review', vendorBasePath: vendorRoot })
  const pipeline = await skills.get(PIPELINE_SKILL_NAME, { cwd: repoRoot })
  assert.ok(pipeline !== undefined)
  assert.equal(pipeline.metadata.unavailableReferenceCount, MISSING_TARGETS.length)
  assert.deepEqual(pipeline.metadata.unavailableReferences, MISSING_TARGETS)
  assert.ok(pipeline.content.includes(PORT_NOTICE_BEGIN))
  assert.ok(pipeline.content.includes(PORT_NOTICE_END))
  // Through the host registry, the clean skills stay clean: the notice is not added by the
  // plugin layer on top of the provider, so the two layers cannot disagree.
  for (const cleanName of [REVIEW_SKILL_NAME, DEEP_RESEARCH_SKILL_NAME]) {
    const clean = await skills.get(cleanName, { cwd: repoRoot })
    assert.ok(clean !== undefined, cleanName + ' must be served')
    assert.equal(clean.content.includes(PORT_NOTICE_BEGIN), false, cleanName + ' must be served without a notice')
    assert.equal(clean.metadata.unavailableReferenceCount, 0)
  }
})

test('the shared/ scope is reported in metadata for both skills, with the body untouched', async () => {
  const instance = provider()
  const candidates = await instance.list()
  const reviewer = await instance.get(candidates.find(item => item.name === REVIEW_SKILL_NAME), {})
  const research = await instance.get(candidates.find(item => item.name === DEEP_RESEARCH_SKILL_NAME), {})

  const reviewerShared = reviewer.metadata.unavailableSharedReferences
  const researchShared = research.metadata.unavailableSharedReferences
  const pipeline = await instance.get(candidates.find(item => item.name === PIPELINE_SKILL_NAME), {})
  const pipelineShared = pipeline.metadata.unavailableSharedReferences

  // Both skills read the same shared/ protocol files, so both must disclose the
  // same misses - which is exactly why this cannot live in a served body.
  assert.deepEqual(reviewerShared, researchShared)
  assert.ok(reviewerShared.length > 0)
  assert.equal(reviewer.metadata.unavailableSharedReferenceCount, reviewerShared.length)
  assert.equal(research.metadata.unavailableSharedReferenceCount, researchShared.length)
  assert.equal(reviewerShared.length, SHARED_SCOPE_TARGETS, 'the shared scope moved: ' + reviewerShared.join(', '))
  assert.deepEqual(pipelineShared, reviewerShared,
    'the shared scope is a property of shared/, so a skill that reaches it must report the same set')
  // The known upstream areas the shared files point at, spot-checked by name. Both
  // vendored trees (academic-paper, academic-pipeline) are resolved now, so what remains
  // is the documentation and adapter directories this port still does not ship.
  assert.ok(reviewerShared.includes('scripts/adapters/'), reviewerShared.join(', '))
  assert.ok(reviewerShared.includes('examples/passport_with_experiment_provenance.yaml'), reviewerShared.join(', '))
  // The negative half, which is what proves the vendoring worked: the two references that
  // used to dangle under the pipeline and paper trees must no longer be reported. Without
  // this, a disclosure that regressed to the old target list would satisfy everything above.
  for (const resolvedNow of [
    'academic-pipeline/references/plagiarism_detection_protocol.md',
    'academic-paper/references/abstract_writing_guide.md',
  ]) {
    assert.equal(reviewerShared.includes(resolvedNow), false,
      resolvedNow + ' is vendored, so it must have stopped being reported: ' + reviewerShared.join(', '))
  }
  // ...and the negative half, which is the proof the vendoring actually worked: the
  // reference that used to dangle under academic-paper/ must no longer be reported.
  // Without this, a disclosure that regressed to the old 14-target list would still
  // satisfy every assertion above.
  assert.equal(reviewerShared.includes('academic-paper/references/abstract_writing_guide.md'), false,
    'academic-paper is vendored, so this reference must have stopped being reported: ' + reviewerShared.join(', '))

  // The two scopes answer different questions, so they are carried separately: a skill can
  // be served clean on its own tree while the shared files it reads still name misses.
  assert.deepEqual(research.metadata.unavailableReferences, [], 'the deep-research own-tree scope is clean now')
  assert.equal(research.metadata.unavailableSharedReferenceCount, SHARED_SCOPE_TARGETS,
    'the shared scope must not be conflated with the own-tree scope')
  assert.equal(reviewer.metadata.unavailableReferences.length, 0, 'the reviewer own-tree scope is clean')
  // ...and the pipeline is the mirror image: own-tree misses AND the shared set, with the
  // own-tree list the shorter of the two. That asymmetry is what the two fields are for.
  assert.deepEqual(pipeline.metadata.unavailableReferences, MISSING_TARGETS)
  assert.equal(pipelineShared.length > pipeline.metadata.unavailableReferences.length, true,
    'the shared scope must be reported independently of the own-tree scope')

  // The bodies are untouched by any of this. Each payload is rebuilt from its parts - the
  // prepended block, the vendored body, and the notice the provider derives - so the
  // assertion derives the payload rather than restating a total.
  const block = renderWritePolicyBlock()
  const reviewerBody = await vendoredBody(REVIEW_SKILL_NAME)
  const researchBody = await vendoredBody(DEEP_RESEARCH_SKILL_NAME)
  assert.equal(reviewer.content, block + reviewerBody)
  assert.equal(research.content, block + researchBody, 'deep-research is block + body, with no notice to append')
})

test('the shared scope walks only shared/ markdown the skill actually reaches', async () => {
  const instance = provider()
  const reviewerScopes = await instance.referenceScopesOf(REVIEW_SKILL_NAME)
  const researchScopes = await instance.referenceScopesOf(DEEP_RESEARCH_SKILL_NAME)

  for (const scopes of [reviewerScopes, researchScopes]) {
    assert.ok(scopes.sharedFiles.length > 0)
    for (const file of scopes.sharedFiles) {
      assert.ok(file.startsWith('shared/'), file + ' is not a shared/ file')
      assert.ok(file.endsWith('.md'), file + ' is not markdown')
      assert.equal(await existsInside(vendorRoot, file), true, file + ' was walked but does not exist')
    }
    // Deterministic: sorted, no duplicates.
    assert.deepEqual(scopes.sharedFiles, [...new Set(scopes.sharedFiles)].sort())
  }
  // The three files the captain called out are genuinely in the walked set.
  for (const file of ['shared/handoff_schemas.md', 'shared/agents/compliance_agent.md', 'shared/compliance_checkpoint_protocol.md']) {
    assert.equal(reviewerScopes.sharedFiles.includes(file), true, file + ' was not walked: ' + reviewerScopes.sharedFiles.join(', '))
  }
  // deep-research reaches strictly more shared/ files than the reviewer here, but
  // lands on the same miss set (asserted in the test above).
  assert.ok(researchScopes.sharedFiles.length >= reviewerScopes.sharedFiles.length)

  // Every missing row names at least one shared/ file as its source.
  for (const entry of reviewerScopes.shared) {
    assert.ok(entry.sources.length > 0)
    for (const source of entry.sources) assert.ok(source.startsWith('shared/'), source + ' is not a shared/ source')
  }
})

test('metadata counts and arrays agree for every served skill', async () => {
  const ctx = new Context()
  const skills = new SkillRegistry(ctx)
  registerReviewSkillProvider(ctx, { providerName: 'academic-review', vendorBasePath: vendorRoot })
  const summaries = await skills.list({ cwd: repoRoot })
  assert.ok(summaries.length >= 2)
  for (const summary of summaries) {
    const definition = await skills.get(summary.name, { cwd: repoRoot })
    assert.ok(definition !== undefined)
    const { unavailableReferences, unavailableReferenceCount, unavailableSharedReferences, unavailableSharedReferenceCount } = definition.metadata
    assert.ok(Array.isArray(unavailableReferences))
    assert.ok(Array.isArray(unavailableSharedReferences))
    assert.equal(unavailableReferenceCount, unavailableReferences.length, summary.name + ' own count/array disagree')
    assert.equal(unavailableSharedReferenceCount, unavailableSharedReferences.length, summary.name + ' shared count/array disagree')
    assert.deepEqual([...unavailableReferences].sort(), unavailableReferences)
    assert.deepEqual([...unavailableSharedReferences].sort(), unavailableSharedReferences)
    for (const target of [...unavailableReferences, ...unavailableSharedReferences]) {
      assert.equal(await existsInside(vendorRoot, target), false, target + ' is reported unavailable but exists')
    }
  }
})
