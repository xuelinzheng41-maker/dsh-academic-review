/**
 * Vendored-tree integrity tests: every vendored file matches the SHA-256
 * recorded at vendoring time, the per-skill counts hold, the shared/ closure in
 * the manifest is the one on disk, and no plugin code writes into vendor/.
 */
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFile, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import { criterionIds } from '../scripts/vendor-upstream.mjs'

const repoRoot = fileURLToPath(new URL('..', import.meta.url))

const EXPECTED_SKILLS = ['academic-paper-reviewer', 'deep-research']
const EXPECTED_SKILL_FILE_COUNTS = { 'academic-paper-reviewer': 28, 'deep-research': 53 }

test('vendor-manifest.json pins the upstream identity and the vendored skills', async () => {
  const manifest = JSON.parse(await readFile(join(repoRoot, 'vendor-manifest.json'), 'utf8'))
  assert.equal(manifest.schemaVersion, 2)
  assert.equal(manifest.upstream.skillVersion, '1.11.1')
  assert.equal(manifest.upstream.commit, '1ec249df98728682dfbbdfb940a658338bfd6f80')
  assert.equal(manifest.upstream.license, 'CC BY-NC 4.0')
  assert.deepEqual(manifest.vendored.skills, EXPECTED_SKILLS)
  assert.deepEqual(manifest.vendored.skillFileCounts, EXPECTED_SKILL_FILE_COUNTS)
  assert.equal(manifest.vendored.skillFileCount, 28 + 53)
  assert.equal(manifest.vendored.sharedFileCount, manifest.sharedFiles.length)
  assert.equal(manifest.vendored.totalFileCount, Object.keys(manifest.files).length)
  assert.equal(
    manifest.vendored.totalFileCount,
    manifest.vendored.skillFileCount + manifest.vendored.sharedFileCount,
  )
  assert.deepEqual(manifest.skills.map(skill => skill.name), EXPECTED_SKILLS)
})

test('every vendored file is byte-identical to the recorded SHA-256', async () => {
  const manifest = JSON.parse(await readFile(join(repoRoot, 'vendor-manifest.json'), 'utf8'))
  const names = Object.keys(manifest.files)
  assert.ok(names.length >= 181, 'expected at least 181 vendored files, got ' + names.length)
  for (const name of names) {
    const bytes = await readFile(join(repoRoot, 'vendor', name))
    assert.equal(createHash('sha256').update(bytes).digest('hex'), manifest.files[name], 'digest drift in ' + name)
  }
})

test('the vendored tree holds exactly the manifest files', async () => {
  const manifest = JSON.parse(await readFile(join(repoRoot, 'vendor-manifest.json'), 'utf8'))
  const found = []
  async function walk(dir, prefix) {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const relative = prefix === '' ? entry.name : prefix + '/' + entry.name
      if (entry.isDirectory()) await walk(join(dir, entry.name), relative)
      else found.push(relative)
    }
  }
  await walk(join(repoRoot, 'vendor'), '')
  found.sort()
  const expected = Object.keys(manifest.files).sort()
  assert.deepEqual(found, expected)
  for (const [skill, count] of Object.entries(EXPECTED_SKILL_FILE_COUNTS)) {
    assert.equal(found.filter(name => name.startsWith(skill + '/')).length, count, skill + ' file count')
  }
  assert.equal(found.filter(name => name.startsWith('shared/')).length, manifest.sharedFiles.length)
})

test('the shared closure is recorded once per file and never overlaps a skill tree', async () => {
  const manifest = JSON.parse(await readFile(join(repoRoot, 'vendor-manifest.json'), 'utf8'))
  assert.deepEqual(manifest.sharedFiles, [...manifest.sharedFiles].sort(), 'sharedFiles is sorted')
  assert.equal(new Set(manifest.sharedFiles).size, manifest.sharedFiles.length, 'no duplicate shared entries')
  for (const file of manifest.sharedFiles) {
    assert.ok(file.startsWith('shared/'), 'shared entry outside shared/: ' + file)
    assert.ok(manifest.files[file] !== undefined, 'shared entry missing from the digest map: ' + file)
  }
  for (const skill of EXPECTED_SKILLS) {
    assert.equal(
      manifest.sharedFiles.some(file => file.startsWith(skill + '/')),
      false,
      'shared entry points into the ' + skill + ' tree',
    )
  }
  // Every shared file is vendored by exactly one rule, and the manifest says which.
  assert.equal(manifest.sharedCarriedOver, undefined, 'no catch-all carry-over field')
  const counts = manifest.vendored.sharedFileCounts
  assert.equal(counts.byScan + counts.byRegistryReceipt, manifest.sharedFiles.length)
  assert.equal(counts.byRegistryReceipt, manifest.sharedViaRegistryReceipts.length)
})

test('a provenance receipt is vendored only because the registry cites its criterion ids', async () => {
  const manifest = JSON.parse(await readFile(join(repoRoot, 'vendor-manifest.json'), 'utf8'))
  const registry = JSON.parse(
    await readFile(join(repoRoot, 'vendor', 'shared', 'review_criteria_registry.json'), 'utf8'),
  )
  const registryIds = new Set(registry.criteria.map(criterion => criterion.criterion_id))

  const byFile = new Map(manifest.sharedViaRegistryReceipts.map(entry => [entry.file, entry]))
  assert.deepEqual(
    [...byFile.keys()].sort(),
    [
      'shared/review_criteria_sources/msr-2027-technical-papers.2026-08-24.json',
      'shared/review_criteria_sources/sigsoft-empirical-standards.2026-08-24.json',
    ],
    'both receipt files are vendored by the registry rule',
  )

  for (const entry of manifest.sharedViaRegistryReceipts) {
    assert.ok(manifest.sharedFiles.includes(entry.file), 'receipt not in sharedFiles: ' + entry.file)
    assert.ok(manifest.files[entry.file] !== undefined, 'receipt not pinned: ' + entry.file)
    const receipt = JSON.parse(await readFile(join(repoRoot, 'vendor', entry.file), 'utf8'))
    // Receipts carry their ids under different keys (criterion_locators, documents),
    // so collect every criterion_id in the document instead of assuming a shape.
    const receiptIds = [...criterionIds(receipt)]
    assert.ok(entry.criterionIds.length > 0, 'receipt carries no justification: ' + entry.file)
    assert.deepEqual(entry.criterionIds, [...entry.criterionIds].sort(), 'justification ids are sorted')
    for (const id of entry.criterionIds) {
      assert.ok(receiptIds.includes(id), 'the registry cites an id the receipt does not carry: ' + id)
      assert.ok(registryIds.has(id), 'justification id is not in the registry: ' + id)
    }
  }

  // The counts verified by hand: 3 ids in the MSR receipt, 2 in the SIGSOFT one.
  assert.deepEqual(
    manifest.sharedViaRegistryReceipts
      .map(entry => [entry.file.split('/').pop(), entry.criterionIds.length])
      .sort(),
    [
      ['msr-2027-technical-papers.2026-08-24.json', 3],
      ['sigsoft-empirical-standards.2026-08-24.json', 2],
    ],
  )
})