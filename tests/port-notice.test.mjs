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

  const missingTarget = 'academic-pipeline/references/literature_corpus_consumers.md'
  // The upstream body is served first, unmodified, and the notice is appended.
  assert.ok(definition.content.startsWith(body), 'the vendored body must be served unmodified')
  const notice = definition.content.slice(body.length)
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

  assert.equal(definition.content, body)
  assert.equal(definition.content.includes(PORT_NOTICE_BEGIN), false)
  assert.equal(Buffer.byteLength(definition.content, 'utf8'), Buffer.byteLength(body, 'utf8'))
  assert.deepEqual(definition.metadata.unavailableReferences, [])
  assert.equal(definition.metadata.unavailableReferenceCount, 0)
  assert.equal(renderPortNotice(REVIEW_SKILL_NAME, []), '')
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
