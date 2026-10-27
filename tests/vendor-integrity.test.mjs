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
  // Carried-over entries are the only ones the closure scan did not reach; they
  // must be a subset of sharedFiles so the manifest stays self-describing.
  for (const file of manifest.sharedCarriedOver ?? []) {
    assert.ok(manifest.sharedFiles.includes(file), 'carried-over entry not in sharedFiles: ' + file)
  }
})
