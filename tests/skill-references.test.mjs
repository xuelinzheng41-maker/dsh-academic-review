/**
 * Reference-integrity and skill-loading acceptance tests for the vendored
 * skills (P3-1).
 *
 * A vendored skill whose internal references dangle is worse than no skill: the
 * agent is told to read a path that does not exist and improvises instead. So
 * every markdown file under vendor/ is walked - both skill trees and the shared/
 * tree the skills send the agent into - and every relative link and bare
 * shared/... path is resolved against the vendored tree on disk.
 *
 * What counts as a reference:
 * - markdown links [text](target) whose target is not http(s)/mailto/#anchor;
 * - bare shared/... paths in prose or code spans.
 * Template placeholders (shared/contracts/<domain>/<mode>.json), brace/star/$
 * patterns and a bare "shared/" are not references and are counted separately.
 *
 * Two kinds of target are distinguished:
 * - IN PORT: the target lives under a directory this port vendors. It must
 *   exist; a miss is a real defect and fails the test.
 * - OUT OF PORT: the target starts with an upstream area that is not vendored
 *   here (other upstream skills, docs/, examples/, scripts/). These are
 *   recorded in UNVENDORED_UPSTREAM_AREAS with the reason, MUST NOT be patched
 *   by editing vendored text, and are reported instead. The assertion is
 *   two-sided: no unseen area may appear, and no listed area may become unused.
 *
 * @module dsh-academic-review/tests/skill-references
 */

import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import { Context } from '@deepseek-ai/cordis'
import { SkillRegistry } from '@deepseek-ai/dsh-skill'
import {
  DEEP_RESEARCH_SKILL_NAME,
  REVIEW_SKILL_NAME,
  VendoredSkillsProvider,
  defaultVendorBasePath,
  parseSkillDocument,
  registerReviewSkillProvider,
} from '../lib/skills.js'

const repoRoot = fileURLToPath(new URL('..', import.meta.url))
const vendorRoot = defaultVendorBasePath()
const vendorDir = join(repoRoot, 'vendor')

/**
 * Upstream areas a vendored file may name without the target being vendored
 * here, with the reason each one is out of port. These are REPORTED, never
 * fixed by editing vendored text or by adding files: the port vendors exactly
 * the skills the plugin serves plus their shared/ closure.
 */
const UNVENDORED_UPSTREAM_AREAS = new Map([
  ['academic-pipeline', 'upstream skill academic-pipeline: not vendored by this port'],
  ['docs', 'upstream repository docs/design specs: not vendored by this port'],
  ['examples', 'upstream repository examples/: not vendored by this port'],
  ['scripts', 'upstream repository scripts/: not vendored by this port'],
])

import {
  PLACEHOLDER,
  existsInside,
  normalizeReference,
  referencesIn,
  resolveReference,
  scanVendorReferences,
} from '../lib/references.js'

/** Whether a vendored relative path exists as a file or a directory. */
const existsInsideVendor = relative => existsInside(vendorDir, relative)

/** Scan the whole vendored tree with the plugin's single scanner implementation. */
const scanVendoredReferences = () => scanVendorReferences({ vendorBasePath: vendorRoot })

test('every vendored markdown reference resolves inside vendor/, except the unvendored upstream areas', async () => {
  const scan = await scanVendoredReferences()

  const inPort = scan.missing.filter(entry => !UNVENDORED_UPSTREAM_AREAS.has(entry.target.split('/')[0]))
  const outOfPort = scan.missing.filter(entry => UNVENDORED_UPSTREAM_AREAS.has(entry.target.split('/')[0]))
  const outOfPortAreas = [...new Set(outOfPort.map(entry => entry.target.split('/')[0]))].sort()
  const distinctOutOfPortTargets = [...new Set(outOfPort.map(entry => entry.target))].sort()

  console.log('# reference integrity: '
    + String(scan.files.length) + ' markdown files scanned, '
    + String(scan.references) + ' references found ('
    + String(scan.links) + ' relative links + ' + String(scan.sharedPaths) + ' bare shared/ paths), '
    + String(scan.placeholders) + ' template placeholders skipped, '
    + String(scan.resolved.length) + ' resolved inside vendor/, '
    + String(inPort.length) + ' missing in port, '
    + String(outOfPort.length) + ' out-of-port ('
    + String(distinctOutOfPortTargets.length) + ' distinct targets across ' + String(outOfPortAreas.length) + ' unvendored upstream areas)')

  // The walk has to cover every skill the manifest says is vendored, plus the
  // shared tree the skills read. Derived, not hard-coded: a newly vendored skill
  // must show up here without anyone remembering to edit this list.
  const manifest = JSON.parse(await readFile(join(repoRoot, 'vendor-manifest.json'), 'utf8'))
  assert.deepEqual(
    [...new Set(scan.files.map(name => name.split('/')[0]))].sort(),
    [...manifest.skills.map(skill => skill.name), 'shared'].sort(),
    'the walk must cover every vendored area',
  )
  assert.equal(
    scan.files.filter(name => name.startsWith(REVIEW_SKILL_NAME + '/')).length,
    manifest.skills.find(skill => skill.name === REVIEW_SKILL_NAME).fileCount,
    'every academic-paper-reviewer file is scanned, markdown or not',
  )
  assert.ok(scan.files.length >= 100, 'expected the whole vendored tree, got ' + String(scan.files.length) + ' markdown files')
  assert.ok(scan.references >= 300, 'expected at least 300 references, got ' + String(scan.references))

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
  // cannot silently absorb a new upstream area or rot.
  assert.deepEqual(outOfPortAreas, [...UNVENDORED_UPSTREAM_AREAS.keys()].sort(), 'unvendored upstream areas changed')
  for (const entry of outOfPort) {
    assert.ok(
      UNVENDORED_UPSTREAM_AREAS.has(entry.target.split('/')[0]),
      entry.file + ' -> ' + entry.raw + ' is out of port without a recorded reason',
    )
  }
  for (const target of distinctOutOfPortTargets) {
    console.log('# out of port: ' + target + '  <- referenced by '
      + [...new Set(outOfPort.filter(entry => entry.target === target).map(entry => entry.file))].join(', '))
  }
})

test('the deep-research tree references 34 distinct shared/ paths and every one is vendored', async () => {
  const scan = await scanVendoredReferences()
  const fromDeepResearch = scan.resolved
    .filter(entry => entry.file.startsWith(DEEP_RESEARCH_SKILL_NAME + '/'))
    .filter(entry => entry.target.startsWith('shared/'))
  const distinct = [...new Set(fromDeepResearch.map(entry => entry.target))].sort()

  console.log('# deep-research: ' + String(fromDeepResearch.length) + ' shared/ references to '
    + String(distinct.length) + ' distinct vendored paths')

  // The vendored tree is pinned by SHA-256, so this number is a fixed fact of
  // the snapshot: a drop means files went missing from the closure.
  assert.equal(distinct.length, 34, 'deep-research should reach 34 distinct shared/ paths, saw ' + String(distinct.length))
  for (const target of distinct) {
    assert.ok(target.startsWith('shared/'), target + ' is not under shared/')
    assert.equal(await existsInsideVendor(target), true, 'deep-research references a missing shared file: ' + target)
    assert.equal(target.includes('..'), false, target + ' escapes shared/')
  }

  // The reviewer tree resolves too, and both skills land in the same shared tree.
  const fromReviewer = scan.resolved
    .filter(entry => entry.file.startsWith(REVIEW_SKILL_NAME + '/'))
    .filter(entry => entry.target.startsWith('shared/'))
  assert.ok(fromReviewer.length > 0, 'the reviewer tree should also reach shared/')
  for (const entry of fromReviewer) assert.equal(await existsInsideVendor(entry.target), true, entry.target)
})

test('the deep-research frontmatter parses and the provider serves it with a port notice', async () => {
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

  // Mount the real provider on a real registry and load the skill as a session would.
  const ctx = new Context()
  const skills = new SkillRegistry(ctx)
  registerReviewSkillProvider(ctx, { providerName: 'academic-review', vendorBasePath: vendorRoot })
  const summaries = await skills.list({ cwd: repoRoot })
  assert.deepEqual(summaries.map(summary => summary.name), ['academic-paper', REVIEW_SKILL_NAME, DEEP_RESEARCH_SKILL_NAME])

  const definition = await skills.get(DEEP_RESEARCH_SKILL_NAME, { cwd: repoRoot })
  assert.ok(definition !== undefined, 'the provider must serve deep-research')
  assert.equal(definition.name, DEEP_RESEARCH_SKILL_NAME)
  assert.equal(typeof definition.description, 'string')
  assert.ok(definition.description.trim().length > 0, 'served description must be non-empty')
  assert.match(definition.description, /deep research/iu)
  assert.equal(definition.content.startsWith('---'), false, 'served body must not start with the frontmatter fence')
  assert.ok(definition.content.length > 1000, 'served body looks truncated')
  assert.equal(definition.resourceBase.kind, 'directory')
  assert.equal(definition.resourceBase.path, join(vendorRoot, DEEP_RESEARCH_SKILL_NAME))
  assert.equal(definition.metadata.upstreamSkillVersion, '2.12.1')
  // The one reference this skill names but this port does not ship is disclosed
  // at serve time (see tests/port-notice.test.mjs for the full contract).
  assert.equal(definition.metadata.unavailableReferenceCount, 1)
  assert.ok(definition.content.startsWith(parseSkillDocument(raw).body), 'upstream body must be served first, unmodified')
  assert.ok(existsInsideVendor(DEEP_RESEARCH_SKILL_NAME + '/SKILL.md'))
  assert.equal(await existsInsideVendor(DEEP_RESEARCH_SKILL_NAME + '/SKILL.md'), true)
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

  // Placeholders are not references; external URLs and anchors are ignored.
  assert.deepEqual(
    referencesIn('shared/handoff_schemas.md', 'shared/contracts/<domain>/<mode>.json and [web](https://example.org) and [here](#anchor)')
      .map(entry => entry.raw),
    ['shared/contracts/<domain>/<mode>.json'],
  )
  assert.equal(PLACEHOLDER.test('shared/contracts/<domain>/<mode>.json'), true)
})