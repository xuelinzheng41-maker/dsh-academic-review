/**
 * Packaging tests: the manifest, the bundle patch, and the built artifacts must
 * agree with each other, or the plugin installs into a dsh profile and silently
 * contributes nothing.
 */
import assert from 'node:assert/strict'
import { access, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

const repoRoot = fileURLToPath(new URL('..', import.meta.url))

/** Read package.json once per assertion group. */
async function manifest() {
  return JSON.parse(await readFile(join(repoRoot, 'package.json'), 'utf8'))
}

test('the package manifest declares the DSH plugin contract', async () => {
  const pkg = await manifest()
  assert.equal(pkg.name, 'dsh-academic-skills')
  assert.equal(pkg.type, 'module')
  assert.equal(pkg.main, 'lib/index.js')
  assert.equal(pkg.license, 'CC-BY-NC-4.0')
  assert.equal(pkg.exports['.'].default, './lib/index.js')
  assert.equal(pkg.exports['./client'].default, './lib/client.js')
  assert.equal(pkg.exports['./cordis.patch.yml'], './cordis.patch.yml')
  assert.equal(pkg.dsh.bundle.patch, './cordis.patch.yml')
  assert.equal(pkg.dsh.client.platform, 'web')
  assert.ok(Array.isArray(pkg.dsh.client.inject))
  assert.ok(pkg.files.includes('vendor'))
  assert.ok(!pkg.license.startsWith('MIT'))
})

test('the bundle patch mounts exactly one plugin row for this package', async () => {
  const pkg = await manifest()
  const patch = await readFile(join(repoRoot, 'cordis.patch.yml'), 'utf8')
  const idMatches = patch.match(/^\s*- id: (\S+)$/gm) ?? []
  assert.equal(idMatches.length, 1, 'expected exactly one inserted plugin row')
  const nameMatches = patch.match(/^\s*name: (\S+)$/gm) ?? []
  assert.equal(nameMatches.length, 1)
  assert.ok(patch.includes('name: ' + pkg.name))
  assert.ok(patch.includes('stateDir: .academic-review'))
})

test('every patch config key exists in the plugin Config schema', async () => {
  const patch = await readFile(join(repoRoot, 'cordis.patch.yml'), 'utf8')
  const configBlock = patch.split('config:')[1] ?? ''
  const keys = [...configBlock.matchAll(/^\s{8}([A-Za-z][A-Za-z0-9]*):/gm)].map(match => match[1])
  assert.ok(keys.length >= 3, 'expected the patch to configure the plugin')
  const source = await readFile(join(repoRoot, 'src', 'index.ts'), 'utf8')
  const schemaBlock = source.split('export const Config = z.object({')[1] ?? ''
  for (const key of keys) {
    assert.ok(schemaBlock.includes(key + ':'), 'patch key ' + key + ' is not in the Config schema')
  }
})

test('the built host and browser entrypoints exist', async () => {
  await access(join(repoRoot, 'lib', 'index.js'))
  await access(join(repoRoot, 'lib', 'state.js'))
  await access(join(repoRoot, 'lib', 'skills.js'))
  await access(join(repoRoot, 'lib', 'tools.js'))
  const client = await readFile(join(repoRoot, 'lib', 'client.js'), 'utf8')
  assert.match(client, /window\.__ModuleLoader__\.load\(/)
  assert.ok(client.includes(JSON.stringify('dsh-academic-skills')))
})

test('the plugin source never writes into vendor/', async () => {
  for (const name of ['index.ts', 'skills.ts', 'state.ts', 'tools.ts']) {
    const source = await readFile(join(repoRoot, 'src', name), 'utf8')
    assert.ok(!/writeFile|writeTextAtomic|writeJsonAtomic/.test(source) || name === 'state.ts',
      name + ' must not write files outside the review-state module')
    for (const line of source.split('\n')) {
      if (!/writeFile|writeTextAtomic|writeJsonAtomic|mkdir/.test(line)) continue
      assert.ok(!/vendor/i.test(line), name + ' writes into the vendored tree: ' + line.trim())
    }
  }
})
