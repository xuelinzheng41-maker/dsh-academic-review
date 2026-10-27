/**
 * Served-skill port notice tests (P3-1, t14).
 *
 * deep-research/agents/bibliography_agent.md instructs the model to read
 * ../../academic-pipeline/references/literature_corpus_consumers.md, which this
 * package does not contain. A prompt-only skill that points at a missing file
 * teaches the model to improvise, so the provider now appends a delimited port
 * notice naming the missing paths and mirroring them in metadata - while a skill
 * with nothing missing is served byte-identically to the vendored body.
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

test('deep-research is served with a notice naming the one reference this port does not ship', async () => {
  const instance = provider()
  const candidates = await instance.list()
  const candidate = candidates.find(item => item.name === DEEP_RESEARCH_SKILL_NAME)
  const definition = await instance.get(candidate, {})
  const body = await vendoredBody(DEEP_RESEARCH_SKILL_NAME)
  const block = renderWritePolicyBlock()

  const missingTarget = 'academic-pipeline/references/literature_corpus_consumers.md'
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

  // Exactly that one path, named with its referencing file, and nothing else.
  const named = [...notice.matchAll(/`([^`]+.(?:md|json|yaml|ya?ml))`/gu)].map(match => match[1])
  assert.deepEqual([...new Set(named)].sort(), [missingTarget, 'agents/bibliography_agent.md'].sort())
  assert.equal(notice.includes('academic-paper/references'), false, 'shared-tree misses are not this skill\'s notice')
  assert.match(notice, /named by `agents\/bibliography_agent\.md`/u)

  // Mirror in metadata for a UI that never parses the body.
  assert.deepEqual(definition.metadata.unavailableReferences, [missingTarget])
  assert.equal(definition.metadata.unavailableReferenceCount, 1)

  // Short enough to stay a footnote, not a second document.
  assert.ok(notice.split('\n').length <= 16, 'notice is ' + notice.split('\n').length + ' lines')
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
  const target = 'academic-pipeline/references/literature_corpus_consumers.md'
  const scan = await scanVendorReferences({ vendorBasePath: vendorRoot, skillName: DEEP_RESEARCH_SKILL_NAME })
  assert.deepEqual(scan.missing.map(entry => entry.target), [target])
  assert.equal(scan.resolved.some(entry => entry.target === target), false)
  assert.equal(scan.resolved.length + scan.missing.length, scan.references)
  assert.equal(await existsInside(vendorRoot, target), false)
  assert.equal(await existsInside(vendorRoot, 'deep-research/SKILL.md'), true)

  const missing = await missingReferencesForSkill({ vendorBasePath: vendorRoot, skillName: DEEP_RESEARCH_SKILL_NAME })
  assert.deepEqual(missing, [{ target, sources: ['deep-research/agents/bibliography_agent.md'] }])
  // The reviewer's own tree is clean, so it never gets a notice.
  assert.deepEqual(await missingReferencesForSkill({ vendorBasePath: vendorRoot, skillName: REVIEW_SKILL_NAME }), [])
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
  const research = await skills.get(DEEP_RESEARCH_SKILL_NAME, { cwd: repoRoot })
  assert.ok(research !== undefined)
  assert.equal(research.metadata.unavailableReferenceCount, 1)
  assert.deepEqual(research.metadata.unavailableReferences, ['academic-pipeline/references/literature_corpus_consumers.md'])
  assert.ok(research.content.includes(PORT_NOTICE_BEGIN))
  const reviewer = await skills.get(REVIEW_SKILL_NAME, { cwd: repoRoot })
  assert.ok(reviewer !== undefined)
  assert.equal(reviewer.content.includes(PORT_NOTICE_BEGIN), false)
  assert.equal(reviewer.metadata.unavailableReferenceCount, 0)
})

test('the shared/ scope is reported in metadata for both skills, with the body untouched', async () => {
  const instance = provider()
  const candidates = await instance.list()
  const reviewer = await instance.get(candidates.find(item => item.name === REVIEW_SKILL_NAME), {})
  const research = await instance.get(candidates.find(item => item.name === DEEP_RESEARCH_SKILL_NAME), {})

  const reviewerShared = reviewer.metadata.unavailableSharedReferences
  const researchShared = research.metadata.unavailableSharedReferences

  // Both skills read the same shared/ protocol files, so both must disclose the
  // same misses - which is exactly why this cannot live in a served body.
  assert.deepEqual(reviewerShared, researchShared)
  assert.ok(reviewerShared.length > 0)
  assert.equal(reviewer.metadata.unavailableSharedReferenceCount, reviewerShared.length)
  assert.equal(research.metadata.unavailableSharedReferenceCount, researchShared.length)
  // The known upstream areas the shared files point at, spot-checked by name.
  // academic-paper is vendored now, so that reference resolves; the misses that
  // remain are the upstream areas this port still does not ship.
  assert.ok(reviewerShared.includes('academic-pipeline/references/plagiarism_detection_protocol.md'), reviewerShared.join(', '))
  assert.ok(reviewerShared.includes('scripts/adapters/'), reviewerShared.join(', '))
  // ...and the negative half, which is the proof the vendoring actually worked: the
  // reference that used to dangle under academic-paper/ must no longer be reported.
  // Without this, a disclosure that regressed to the old 14-target list would still
  // satisfy every assertion above.
  assert.equal(reviewerShared.includes('academic-paper/references/abstract_writing_guide.md'), false,
    'academic-paper is vendored, so this reference must have stopped being reported: ' + reviewerShared.join(', '))

  // deep-research carries BOTH lists separately: one own-tree miss and the shared set.
  assert.deepEqual(research.metadata.unavailableReferences, ['academic-pipeline/references/literature_corpus_consumers.md'])
  assert.equal(research.metadata.unavailableReferenceCount, 1)
  assert.equal(researchShared.length > 1, true, 'the shared scope must not be conflated with the own-tree scope')
  // Overlap is real and honest: bibliography_agent.md names the target directly,
  // and shared/handoff_schemas.md names it too. The scopes answer different
  // questions, so the target may legitimately appear in both.
  assert.equal(researchShared.includes('academic-pipeline/references/literature_corpus_consumers.md'), true)
  assert.equal(reviewer.metadata.unavailableReferences.length, 0, 'the reviewer own-tree scope is clean')

  // The bodies are untouched by any of this. Each payload is rebuilt from its parts - the
  // prepended block, the vendored body, and the notice the provider derives - so the
  // assertion derives the payload rather than restating a total.
  const block = renderWritePolicyBlock()
  const reviewerBody = await vendoredBody(REVIEW_SKILL_NAME)
  const researchBody = await vendoredBody(DEEP_RESEARCH_SKILL_NAME)
  assert.equal(reviewer.content, block + reviewerBody)
  assert.equal(research.content, block + researchBody + renderPortNotice(
    DEEP_RESEARCH_SKILL_NAME,
    [{ target: 'academic-pipeline/references/literature_corpus_consumers.md', sources: ['deep-research/agents/bibliography_agent.md'] }],
  ))
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
