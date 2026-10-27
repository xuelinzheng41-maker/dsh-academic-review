/**
 * Skill-provider tests: the vendored skill is advertised with an absolute
 * resource base, the upstream body is served unmodified, and the vendored tree
 * keeps its byte identity.
 */
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import {
  REVIEW_SKILL_NAME,
  REVIEW_SKILL_SOURCE,
  VendoredReviewSkillProvider,
  defaultResourceBasePath,
  parseSkillDocument,
} from '../lib/skills.js'

const repoRoot = fileURLToPath(new URL('..', import.meta.url))

/** Registration control stand-in; the provider only reads it passively. */
function control() {
  const controller = new AbortController()
  return { signal: controller.signal, invalidate: () => {} }
}

test('the provider advertises the vendored skill with an absolute resource base', async () => {
  const provider = new VendoredReviewSkillProvider(
    { providerName: 'academic-review', resourceBasePath: defaultResourceBasePath() },
    control(),
  )
  const candidates = await provider.list()
  assert.equal(candidates.length, 1)
  const candidate = candidates[0]
  assert.equal(candidate.name, REVIEW_SKILL_NAME)
  assert.equal(candidate.provider, 'academic-review')
  assert.equal(candidate.source, REVIEW_SKILL_SOURCE)
  assert.equal(candidate.rank, 450)
  assert.equal(candidate.resourceBase.kind, 'directory')
  assert.equal(candidate.resourceBase.path, join(repoRoot, 'vendor', 'academic-paper-reviewer'))
  assert.match(candidate.description, /academic|review/i)
  assert.equal(candidate.path, join(candidate.resourceBase.path, 'SKILL.md'))
})

test('the loaded body is the upstream text without frontmatter', async () => {
  const provider = new VendoredReviewSkillProvider(
    { providerName: 'academic-review', resourceBasePath: defaultResourceBasePath() },
    control(),
  )
  const [candidate] = await provider.list()
  const definition = await provider.get(candidate, {})
  assert.equal(definition.name, REVIEW_SKILL_NAME)
  assert.equal(definition.metadata.upstreamSkillVersion, '1.11.1')
  assert.equal(definition.metadata.license, 'CC BY-NC 4.0')
  assert.ok(definition.content.length > 1000)
  assert.ok(!definition.content.startsWith('---'))
  assert.match(definition.content, /Academic Paper Reviewer/)
  // The vendored file itself is untouched: its on-disk bytes still open with
  // frontmatter and match the recorded SHA-256.
  const raw = await readFile(definition.path)
  assert.ok(raw.toString('utf8').startsWith('---'))
  const manifest = JSON.parse(await readFile(join(repoRoot, 'vendor-manifest.json'), 'utf8'))
  const digest = createHash('sha256').update(raw).digest('hex')
  assert.equal(manifest.files['academic-paper-reviewer/SKILL.md'], digest)
})

test('frontmatter parsing keeps quoted scalars intact', () => {
  const parsed = parseSkillDocument('---\nname: demo-skill\ndescription: "A quoted description."\n---\n\n# Body\n')
  assert.equal(parsed.name, 'demo-skill')
  assert.equal(parsed.description, 'A quoted description.')
  assert.equal(parsed.body, '\n# Body\n')
  const plain = parseSkillDocument('# No frontmatter\n')
  assert.equal(plain.name, undefined)
  assert.equal(plain.body, '# No frontmatter\n')
})
