/**
 * Skill-provider tests: every vendored skill is advertised with its own
 * absolute resource base and its own frontmatter metadata, the upstream body is
 * served unmodified, a narrowed selection serves only what it names, and an
 * unknown name is refused instead of silently serving nothing.
 */
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import {
  DEEP_RESEARCH_SKILL_NAME,
  REVIEW_SKILL_NAME,
  REVIEW_SKILL_SOURCE,
  UnknownSkillSelectionError,
  VendoredSkillsProvider,
  defaultResourceBasePath,
  defaultVendorBasePath,
  discoverVendoredSkills,
  parseSkillDocument,
  registerReviewSkillProvider,
  resolveSkillSelection,
  skillResourceBasePath,
} from '../lib/skills.js'

const repoRoot = fileURLToPath(new URL('..', import.meta.url))
const vendorBase = defaultVendorBasePath()

/** The third vendored skill (P3-2). Discovery order is alphabetical. */
const PAPER_SKILL_NAME = 'academic-paper'

/** Registration control stand-in; the provider only reads it passively. */
function control() {
  const controller = new AbortController()
  return { signal: controller.signal, invalidate: () => {} }
}

/** Provider over every vendored skill. */
function provider(config = {}) {
  return new VendoredSkillsProvider({ providerName: 'academic-review', ...config }, control())
}

/** The candidate for one skill name. */
async function candidateFor(skillName, config = {}) {
  const candidates = await provider(config).list()
  const candidate = candidates.find(item => item.name === skillName)
  assert.ok(candidate !== undefined, 'no candidate for ' + skillName + ' in ' + JSON.stringify(candidates.map(c => c.name)))
  return candidate
}

test('discovery lists every vendored skill and skips the shared tree', async () => {
  const discovered = discoverVendoredSkills(vendorBase)
  assert.deepEqual(discovered, [PAPER_SKILL_NAME, REVIEW_SKILL_NAME, DEEP_RESEARCH_SKILL_NAME])
  assert.equal(discovered.includes('shared'), false)
  for (const name of discovered) {
    assert.equal(existsSync(join(vendorBase, name, 'SKILL.md')), true, name + ' has no SKILL.md')
  }
})

test('the provider advertises every vendored skill with an absolute resource base', async () => {
  const candidates = await provider().list()
  assert.deepEqual(candidates.map(item => item.name), [PAPER_SKILL_NAME, REVIEW_SKILL_NAME, DEEP_RESEARCH_SKILL_NAME])
  for (const candidate of candidates) {
    assert.equal(candidate.provider, 'academic-review')
    assert.equal(candidate.source, REVIEW_SKILL_SOURCE)
    assert.equal(candidate.rank, 450)
    assert.equal(candidate.resourceBase.kind, 'directory')
    // Absolute: the host has to be able to read by path.
    assert.equal(candidate.resourceBase.path, join(vendorBase, candidate.name))
    assert.equal(candidate.path, join(candidate.resourceBase.path, 'SKILL.md'))
    assert.equal(existsSync(candidate.path), true, candidate.path + ' does not exist')
    assert.ok(candidate.description.trim().length > 100, candidate.name + ' has no upstream description')
    assert.match(candidate.description, /review|research/i)
    assert.match(candidate.whenToUse ?? '', /Triggers on:/u)
  }
  // The reviewer's base is the historical default path, unchanged.
  const reviewer = candidates.find(item => item.name === REVIEW_SKILL_NAME)
  assert.equal(reviewer.resourceBase.path, defaultResourceBasePath())
  assert.equal(defaultResourceBasePath(), join(repoRoot, 'vendor', 'academic-paper-reviewer'))
  assert.equal(skillResourceBasePath(vendorBase, DEEP_RESEARCH_SKILL_NAME), join(vendorBase, 'deep-research'))
})

test('each skill reports its own frontmatter metadata, not a shared constant', async () => {
  const instance = provider()
  // Look the two skills up by name: the vendored set is no longer fixed at two and
  // discovery order is alphabetical, so positional destructuring would silently
  // compare the wrong skill once a third one is vendored.
  const candidates = await instance.list()
  const reviewer = candidates.find(item => item.name === REVIEW_SKILL_NAME)
  const research = candidates.find(item => item.name === DEEP_RESEARCH_SKILL_NAME)
  const reviewerDefinition = await instance.get(reviewer, {})
  const researchDefinition = await instance.get(research, {})

  // Versions come from each SKILL.md's own metadata.version block.
  assert.equal(reviewerDefinition.metadata.upstreamSkill, REVIEW_SKILL_NAME)
  assert.equal(reviewerDefinition.metadata.upstreamSkillVersion, '1.11.1')
  assert.equal(reviewerDefinition.metadata.upstreamLastUpdated, '2026-08-15')
  assert.equal(researchDefinition.metadata.upstreamSkill, DEEP_RESEARCH_SKILL_NAME)
  assert.equal(researchDefinition.metadata.upstreamSkillVersion, '2.12.1')
  assert.equal(researchDefinition.metadata.upstreamLastUpdated, '2026-08-15')

  // Neither SKILL.md declares a licence, so the repository pin answers and the
  // metadata says so instead of pretending the frontmatter said it.
  for (const definition of [reviewerDefinition, researchDefinition]) {
    assert.equal(definition.metadata.license, 'CC BY-NC 4.0')
    assert.equal(definition.metadata.licenseSource, 'vendor-manifest')
    assert.equal(definition.metadata.unofficialPort, true)
    assert.equal(definition.metadata.vendorDirectory, join(vendorBase, definition.name))
    assert.match(String(definition.metadata.upstreamCommit), /^[0-9a-f]{40}$/)
  }
})

test('the loaded body is the upstream text without frontmatter', async () => {
  const instance = provider()
  const reviewer = await candidateFor(REVIEW_SKILL_NAME)
  const definition = await instance.get(reviewer, {})
  assert.equal(definition.name, REVIEW_SKILL_NAME)
  assert.ok(definition.content.length > 1000)
  assert.ok(!definition.content.startsWith('---'))
  assert.match(definition.content, /Academic Paper Reviewer/)

  // The sibling skill loads just as well, with its own body.
  const research = await candidateFor(DEEP_RESEARCH_SKILL_NAME)
  const researchDefinition = await instance.get(research, {})
  assert.equal(researchDefinition.name, DEEP_RESEARCH_SKILL_NAME)
  assert.ok(researchDefinition.content.length > 1000)
  assert.ok(!researchDefinition.content.startsWith('---'))
  assert.match(researchDefinition.content, /Deep Research/)

  // The vendored file itself is untouched: its on-disk bytes still open with
  // frontmatter and match the recorded SHA-256.
  const raw = await readFile(definition.path)
  assert.ok(raw.toString('utf8').startsWith('---'))
  const manifest = JSON.parse(await readFile(join(repoRoot, 'vendor-manifest.json'), 'utf8'))
  const digest = createHash('sha256').update(raw).digest('hex')
  assert.equal(manifest.files['academic-paper-reviewer/SKILL.md'], digest)
})

test('a narrowed configuration serves only the named skill', async () => {
  const onlyResearch = provider({ skills: [DEEP_RESEARCH_SKILL_NAME] })
  const candidates = await onlyResearch.list()
  assert.deepEqual(candidates.map(item => item.name), [DEEP_RESEARCH_SKILL_NAME])
  const definition = await onlyResearch.get(candidates[0], {})
  assert.equal(definition.metadata.upstreamSkillVersion, '2.12.1')

  const onlyReviewer = provider({ skills: [REVIEW_SKILL_NAME] })
  assert.deepEqual((await onlyReviewer.list()).map(item => item.name), [REVIEW_SKILL_NAME])
  // Selection is order-independent and de-duplicated against the vendored order,
  // and an explicit selection names exactly what is served - vendoring a third
  // skill must not widen it.
  assert.deepEqual(resolveSkillSelection(vendorBase, [DEEP_RESEARCH_SKILL_NAME, REVIEW_SKILL_NAME]),
    [REVIEW_SKILL_NAME, DEEP_RESEARCH_SKILL_NAME])
  // An empty selection means "everything vendored".
  assert.deepEqual(resolveSkillSelection(vendorBase, []), [PAPER_SKILL_NAME, REVIEW_SKILL_NAME, DEEP_RESEARCH_SKILL_NAME])
})

test('an unknown skill name is refused with a clear message', async () => {
  assert.throws(() => resolveSkillSelection(vendorBase, ['no-such-skill']), error => {
    assert.equal(error instanceof UnknownSkillSelectionError, true)
    assert.match(error.message, /unknown vendored skill "no-such-skill"/u)
    assert.match(error.message, /available skills are academic-paper, academic-paper-reviewer, deep-research/u)
    assert.deepEqual(error.available, [PAPER_SKILL_NAME, REVIEW_SKILL_NAME, DEEP_RESEARCH_SKILL_NAME])
    return true
  })
  // A vendor directory with nothing vendored is also a loud failure, not an empty catalog.
  assert.throws(() => resolveSkillSelection(join(repoRoot, 'docs'), []), /nothing is vendored under/u)
  // Registration refuses before it serves anything, so a typo cannot produce an
  // empty profile: the provider is never constructed with an unknown name.
  let registered = false
  const ctx = { skills: { registerProvider: () => { registered = true; return () => {} } } }
  assert.throws(() => registerReviewSkillProvider(ctx, {
    providerName: 'academic-review',
    vendorBasePath: vendorBase,
    skills: ['deep-researchh'],
  }), /unknown vendored skill "deep-researchh"/u)
  assert.equal(registered, false)
})

test('registration serves the configured selection through the host registry contract', async () => {
  let created
  const ctx = { skills: { registerProvider: create => { created = create(control()); return () => {} } } }
  const dispose = registerReviewSkillProvider(ctx, {
    providerName: 'academic-review',
    vendorBasePath: vendorBase,
    skills: [REVIEW_SKILL_NAME],
  })
  assert.equal(typeof dispose, 'function')
  assert.equal(created.name, 'academic-review')
  assert.deepEqual(created.skillNames, [REVIEW_SKILL_NAME])
  const candidates = await created.list({})
  assert.deepEqual(candidates.map(item => item.name), [REVIEW_SKILL_NAME])
})

test('frontmatter parsing keeps quoted scalars intact and reads the metadata block', () => {
  const parsed = parseSkillDocument('---\nname: demo-skill\ndescription: "A quoted description."\nmetadata:\n  version: "9.9.9"\n  last_updated: "2026-01-02"\n  related_skills:\n    - other-skill\n---\n\n# Body\n')
  assert.equal(parsed.name, 'demo-skill')
  assert.equal(parsed.description, 'A quoted description.')
  assert.equal(parsed.fields['description'], 'A quoted description.')
  assert.equal(parsed.metadata['version'], '9.9.9')
  assert.equal(parsed.metadata['last_updated'], '2026-01-02')
  assert.equal(parsed.metadata['related_skills'], undefined)
  assert.equal(parsed.body, '\n# Body\n')
  const plain = parseSkillDocument('# No frontmatter\n')
  assert.equal(plain.name, undefined)
  assert.deepEqual(plain.metadata, {})
  assert.equal(plain.body, '# No frontmatter\n')
  // A skill with no frontmatter description still advertises an honest line.
  const bare = parseSkillDocument('---\nname: bare\n---\nbody\n')
  assert.equal(bare.description, undefined)
})