#!/usr/bin/env node
/**
 * Emit lib/client.js - the browser bundle the DSH client loader mounts.
 *
 * Phase 1 (this task) ships the manifest plumbing only: the bundle registers an
 * inert browser plugin under the package name and contributes no slots, panels,
 * or cards. The review panel itself is T3's scope, which replaces this file with
 * a real tsdown-built React bundle. Keeping the id in sync with package.json
 * here means a rename cannot leave the browser half registering a stale id.
 */
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const manifest = JSON.parse(await readFile(join(repoRoot, 'package.json'), 'utf8'))
const pluginId = manifest.name

const banner = [
  '/**',
  ' * Browser bundle for ' + pluginId + ' (inert Phase 1 placeholder).',
  ' *',
  ' * The review panel, seat status table, and decision view land in T3; until then',
  ' * this module registers no slots and renders nothing. It exists so the package',
  ' * manifest can declare ./client and dsh.client.inject without shipping a',
  ' * half-built UI.',
  ' */',
  'window.__ModuleLoader__.load({',
  '  id: ' + JSON.stringify(pluginId) + ',',
  '  factory: (require) => {',
  '    var module = { exports: {} };',
  '    module.exports = {',
  "      name: 'academic-review-client',",
  '      inject: [],',
  '      apply() {},',
  '    };',
  '    return module.exports;',
  '  },',
  '});',
  '',
].join('\n')

const target = join(repoRoot, 'lib', 'client.js')
await mkdir(dirname(target), { recursive: true })
await writeFile(target, banner, 'utf8')
console.log('build-client: wrote ' + target)
