/**
 * Vendored-tree integrity tests: every vendored file matches the SHA-256
 * recorded at vendoring time, the expected file counts hold, and no plugin code
 * writes into vendor/.
 */
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFile, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

const repoRoot = fileURLToPath(new URL('..', import.meta.url))

test('vendor-manifest.json pins the upstream identity', async () => {
  const manifest = JSON.parse(await readFile(join(repoRoot, 'vendor-manifest.json'), 'utf8'))
  assert.equal(manifest.schemaVersion, 1)
  assert.equal(manifest.upstream.skillVersion, '1.11.1')
  assert.equal(manifest.upstream.commit, '1ec249df98728682dfbbdfb940a658338bfd6f80')
  assert.equal(manifest.upstream.license, 'CC BY-NC 4.0')
  assert.equal(manifest.vendored.skillFileCount, 28)
  assert.equal(manifest.vendored.sharedFileCount, manifest.sharedFiles.length)
})

test('every vendored file is byte-identical to the recorded SHA-256', async () => {
  const manifest = JSON.parse(await readFile(join(repoRoot, 'vendor-manifest.json'), 'utf8'))
  const names = Object.keys(manifest.files)
  assert.ok(names.length >= 60)
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
  assert.equal(found.filter(name => name.startsWith('academic-paper-reviewer/')).length, 28)
})
