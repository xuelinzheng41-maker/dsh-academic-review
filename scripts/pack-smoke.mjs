#!/usr/bin/env node
/**
 * Pack the tarball we would publish, install it into a scratch directory, and
 * assert what actually landed there.
 *
 * Every other CI job runs against the working tree, which cannot see this class of
 * defect at all: a files field or an .npmignore can drop vendor/, lib/ or a
 * SKILL.md and the whole suite still passes, because the suite reads the tree and
 * not the package. So this check builds, packs, installs, and then re-verifies the
 * INSTALLED copy - vendor pins, tool surface, advertised skills and their resource
 * bases, version, and the tarball's own contents and size.
 *
 * Usage: node scripts/pack-smoke.mjs      (after pnpm build)
 */
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdirSync, readFileSync, readdirSync, realpathSync, statSync, symlinkSync, writeFileSync } from 'node:fs'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, sep } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { gunzipSync } from 'node:zlib'
import { verifyVendorTree } from './vendor-upstream.mjs'

const repoRoot = fileURLToPath(new URL('..', import.meta.url))

/** Files the installed package must expose at runtime. */
const REQUIRED_ENTRIES = [
  'package/package.json',
  'package/lib/index.js',
  'package/lib/client.js',
  'package/lib/skills.js',
  'package/lib/tools.js',
  'package/lib/types/index.d.ts',
  'package/cordis.patch.yml',
  'package/vendor-manifest.json',
  'package/LICENSE',
  'package/THIRD_PARTY_NOTICES.md',
  'package/README.md',
]
/** Paths that must never ship: sources, tests, tooling, local state. */
const FORBIDDEN_PREFIXES = ['package/src/', 'package/tests/', 'package/scripts/', 'package/node_modules/', 'package/.git/', 'package/.github/', 'package/.pack/', 'package/.agent-teams/']
const FORBIDDEN_ENTRIES = ['package/tsconfig.json', 'package/tsconfig.client.json', 'package/.npmrc', 'package/.gitattributes', 'package/package-lock.json']
/**
 * Which root-level markdown documents must ship, and why.
 *
 * npm always includes package.json, the README files, the LICENSE files and the
 * file named by 'main', and nothing else: a root CHANGELOG.md ships only when it
 * is listed in package.json 'files'. Both directions are asserted, so a document that starts
 * or stops shipping fails the job instead of drifting quietly - and a new root
 * document that nobody decided about fails too, because it is not in this table.
 */
const ROOT_DOC_POLICY = new Map([
  ['README.md', { shipped: true, why: 'listed in files, and npm always ships README*' }],
  ['README.zh-CN.md', { shipped: true, why: 'listed in files, and npm always ships README*' }],
  ['THIRD_PARTY_NOTICES.md', { shipped: true, why: 'listed in files: the CC BY-NC 4.0 attribution travels with the package' }],
  ['CHANGELOG.md', { shipped: false, why: 'root file, not listed in files, and npm does not auto-include CHANGELOG - only package.json, README*, LICENSE* and main' }],
  ['CONTRIBUTING.md', { shipped: false, why: 'root file, not listed in files: contributor guide is repository-only' }],
  ['MAINTENANCE.md', { shipped: false, why: 'root file, not listed in files: maintainer notes are repository-only' }],
])

/** The five review tools the plugin must register, sorted. */
const TOOL_NAMES = [
  'academic_review_confirm',
  'academic_review_create',
  'academic_review_report',
  'academic_review_status',
  'academic_review_submit',
]

const started = Date.now()
let checks = 0
function ok(message) {
  checks += 1
  console.log('  ok ' + message)
}

function run(command, args, options = {}) {
  const executable = process.platform === 'win32' ? command + '.cmd' : command
  return execFileSync(executable, args, {
    encoding: 'utf8',
    maxBuffer: 1 << 26,
    stdio: ['ignore', 'pipe', 'pipe'],
    shell: process.platform === 'win32',
    ...options,
  })
}

/**
 * Read the entries of a .tgz in pure node, so the check behaves the same on the
 * runner and on a developer machine that has no tar on PATH.
 * @returns entries with their byte ranges inside the uncompressed stream.
 */
export function tarballEntries(tarball) {
  const buffer = gunzipSync(readFileSync(tarball))
  const entries = []
  let offset = 0
  while (offset + 512 <= buffer.length) {
    const header = buffer.subarray(offset, offset + 512)
    if (header.every(byte => byte === 0)) break
    const rawName = header.subarray(0, 100).toString('utf8').replace(/\u0000.*$/s, '')
    const prefix = header.subarray(345, 500).toString('utf8').replace(/\u0000.*$/s, '')
    const name = prefix === '' ? rawName : prefix + '/' + rawName
    const rawSize = header.subarray(124, 136).toString('utf8').replace(/\u0000/g, '').trim()
    const size = Number.parseInt(rawSize === '' ? '0' : rawSize, 8)
    const type = String.fromCharCode(header[156])
    if (type === '0' || type === '\u0000') entries.push({ path: name, size, dataOffset: offset + 512 })
    offset += 512 + Math.ceil(size / 512) * 512
  }
  return { buffer, entries }
}

/** Unpack a tarball into a directory, used only when npm is not installed here. */
function extractTarball(tarball, destination) {
  const { buffer, entries } = tarballEntries(tarball)
  for (const entry of entries) {
    const target = join(destination, entry.path.replace(/^package\//, ''))
    mkdirSync(dirname(target), { recursive: true })
    writeFileSync(target, buffer.subarray(entry.dataOffset, entry.dataOffset + entry.size))
  }
}

function humanSize(bytes) {
  const units = ['B', 'KiB', 'MiB']
  let value = bytes
  let unit = 0
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024
    unit += 1
  }
  return (unit === 0 ? String(value) : value.toFixed(2)) + ' ' + units[unit]
}

/**
 * Is npm usable here? Probed once, up front, because a localized "command not
 * found" message is not reliably matchable after the fact - and because whether
 * the real install path ran must never be guessed.
 */
function npmAvailable() {
  try {
    run('npm', ['--version'])
    return true
  } catch {
    return false
  }
}

async function main() {
  const repoPackage = JSON.parse(readFileSync(join(repoRoot, 'package.json'), 'utf8'))
  const repoManifest = JSON.parse(readFileSync(join(repoRoot, 'vendor-manifest.json'), 'utf8'))
  const root = await mkdtemp(join(tmpdir(), 'dsh-ar-pack-'))
  try {
    console.log('packaging ' + repoPackage.name + '@' + repoPackage.version)
    console.log('temp root: ' + root)
    if (!readdirSync(join(repoRoot, 'lib')).includes('index.js')) {
      throw new Error('lib/index.js is missing: run pnpm build before the smoke test')
    }

    const packDir = join(root, 'pack')
    await mkdir(packDir, { recursive: true })
    run('pnpm', ['pack', '--pack-destination', packDir], { cwd: repoRoot })
    const packed = readdirSync(packDir).filter(name => name.endsWith('.tgz'))
    assert.equal(packed.length, 1, 'expected exactly one tarball, got ' + packed.join(', '))
    const tarball = join(packDir, packed[0])
    const bytes = statSync(tarball).size
    const tarballParts = tarballEntries(tarball)
    const entries = tarballParts.entries
    const paths = entries.map(entry => entry.path)
    const vendored = paths.filter(path => path.startsWith('package/vendor/'))
    const other = paths.filter(path => !path.startsWith('package/vendor/'))

    console.log('')
    console.log('tarball      : ' + packed[0])
    console.log('size         : ' + bytes + ' bytes (' + humanSize(bytes) + ')')
    console.log('entries      : ' + paths.length + ' (' + vendored.length + ' vendored, ' + other.length + ' other)')
    // A silent doubling here means junk is riding along, so the size is always printed.
    ok('tarball packed: ' + humanSize(bytes) + ' across ' + paths.length + ' files')
    console.log('non-vendor files:')
    for (const path of other.slice().sort()) console.log('  ' + path)

    for (const required of REQUIRED_ENTRIES) {
      assert.ok(paths.includes(required), 'the tarball is missing a runtime file: ' + required)
    }
    ok('every runtime file is present (' + REQUIRED_ENTRIES.length + ' required entries)')

    // Documents: npm auto-includes README*, but "auto" is not "verified". Assert the
    // shipped bytes are the repo bytes, and assert the not-shipped ones stay out.
    const rootDocs = readdirSync(repoRoot).filter(name => /\.md$/i.test(name) && statSync(join(repoRoot, name)).isFile())
    for (const name of rootDocs) {
      assert.ok(ROOT_DOC_POLICY.has(name), 'root document ' + name + ' has no shipping decision: add it to ROOT_DOC_POLICY')
    }
    console.log('root documents:')
    for (const name of [...ROOT_DOC_POLICY.keys()].sort()) {
      const policy = ROOT_DOC_POLICY.get(name)
      const packedPath = 'package/' + name
      const entry = tarballParts.entries.find(candidate => candidate.path === packedPath)
      if (!policy.shipped) {
        assert.equal(entry, undefined, packedPath + ' now ships, but ROOT_DOC_POLICY says it should not (' + policy.why + ')')
        console.log('  ' + name + ': not shipped - ' + policy.why)
        continue
      }
      assert.ok(entry !== undefined, 'the tarball is missing ' + name + ' (' + policy.why + ')')
      const packedBytes = tarballParts.buffer.subarray(entry.dataOffset, entry.dataOffset + entry.size)
      const packedDigest = createHash('sha256').update(packedBytes).digest('hex')
      const repoDigest = createHash('sha256').update(readFileSync(join(repoRoot, name))).digest('hex')
      assert.equal(packedDigest, repoDigest, packedPath + ' is not byte-identical to the repo copy: ' + packedDigest + ' != ' + repoDigest)
      assert.ok(entry.size > 0, packedPath + ' ships empty')
      console.log('  ' + name + ': shipped byte-identically (' + entry.size + ' B, ' + policy.why + ')')
    }
    ok('README.md and README.zh-CN.md ship byte-identically; the unlisted root docs stay out as documented')

    // docs/ is shipped wholesale, so every page in it must travel byte-identically.
    const repoDocs = readdirSync(join(repoRoot, 'docs')).filter(name => name.endsWith('.md'))
    for (const name of repoDocs.sort()) {
      const packedPath = 'package/docs/' + name
      const entry = tarballParts.entries.find(candidate => candidate.path === packedPath)
      assert.ok(entry !== undefined, 'the tarball is missing docs/' + name)
      const packedDigest = createHash('sha256')
        .update(tarballParts.buffer.subarray(entry.dataOffset, entry.dataOffset + entry.size))
        .digest('hex')
      const repoDigest = createHash('sha256').update(readFileSync(join(repoRoot, 'docs', name))).digest('hex')
      assert.equal(packedDigest, repoDigest, packedPath + ' is not byte-identical to the repo copy')
    }
    ok('all ' + repoDocs.length + ' docs/*.md pages ship byte-identically (' + repoDocs.sort().join(', ') + ')')

    for (const forbidden of FORBIDDEN_PREFIXES) {
      const hits = paths.filter(path => path.startsWith(forbidden))
      assert.deepEqual(hits, [], 'the tarball ships ' + forbidden + ': ' + hits.slice(0, 5).join(', '))
    }
    for (const forbidden of FORBIDDEN_ENTRIES) {
      assert.equal(paths.includes(forbidden), false, 'the tarball ships ' + forbidden)
    }
    ok('no sources, tests, tooling, local state or lockfiles shipped')

    const expectedVendor = Object.keys(repoManifest.files).map(path => 'package/vendor/' + path).sort()
    assert.deepEqual(vendored.slice().sort(), expectedVendor, 'the tarball does not hold exactly the pinned vendor tree')
    ok('the tarball holds exactly the ' + expectedVendor.length + ' pinned vendor files')

    const scratch = join(root, 'scratch')
    await mkdir(scratch, { recursive: true })
    await writeFile(
      join(scratch, 'package.json'),
      JSON.stringify({ name: 'pack-smoke', private: true, version: '0.0.0', type: 'module' }, null, 2) + '\n',
    )
    const installed = join(scratch, 'node_modules', repoPackage.name)
    // CI always takes the npm path; the fallback only keeps the check runnable on a
    // machine without npm, and it says so in the log instead of pretending.
    const useNpm = npmAvailable()
    const installedVia = useNpm ? 'npm install' : 'tarball extraction (npm is not on PATH here)'
    if (useNpm) {
      run('npm', ['install', '--no-audit', '--no-fund', '--no-package-lock', '--ignore-scripts', tarball], { cwd: scratch })
    } else {
      console.log('  note: npm is not on PATH; unpacking the same tarball instead of installing it')
      extractTarball(tarball, installed)
    }
    assert.ok(readdirSync(installed).includes('package.json'), 'the tarball did not install: ' + installed)
    ok('the tarball installs into a scratch directory via ' + installedVia)

    // Peer dependencies are host-provided by design (peerDependenciesMeta.optional),
    // so give the installed copy the same host packages this repo develops against.
    // Each peer is linked to its REAL path: the entries inside a pnpm node_modules are
    // relative symlinks, and a relative link resolved through one more level of
    // indirection points at a .pnpm directory that does not exist over here.
    const peerScope = join(scratch, 'node_modules', '@deepseek-ai')
    mkdirSync(peerScope, { recursive: true })
    const linkType = process.platform === 'win32' ? 'junction' : 'dir'
    for (const peer of readdirSync(join(repoRoot, 'node_modules', '@deepseek-ai'))) {
      symlinkSync(realpathSync(join(repoRoot, 'node_modules', '@deepseek-ai', peer)), join(peerScope, peer), linkType)
    }

    const installedPackage = JSON.parse(readFileSync(join(installed, 'package.json'), 'utf8'))
    assert.equal(installedPackage.version, repoPackage.version, 'installed version does not match the repo version')
    ok('installed package.json version is ' + installedPackage.version + ', same as the repo')

    // The headline check: the pins have to hold INSIDE the installed copy.
    const verification = await verifyVendorTree({
      vendorRoot: join(installed, 'vendor'),
      manifestPath: join(installed, 'vendor-manifest.json'),
    })
    assert.deepEqual(
      verification.problems,
      [],
      'verify-vendor failed inside the installed package: ' + JSON.stringify(verification.problems.slice(0, 5)),
    )
    assert.equal(verification.fileCount, expectedVendor.length)
    ok('verify-vendor passes inside the installed package: ' + verification.fileCount + ' files byte-identical')

    // The cheap mechanical form of the reproducibility rule: no shipped JS or
    // source map may carry an absolute path. The 0.2.0-rc bundle had
    // D:\Deepseek\... baked into a //#region comment by an absolute virtual module
    // id, and this assertion fails on exactly that artifact.
    const bundleFiles = []
    const collectBundles = directory => {
      for (const entry of readdirSync(directory, { withFileTypes: true })) {
        const path = join(directory, entry.name)
        if (entry.isDirectory()) collectBundles(path)
        else if (/\.(?:js|map)$/.test(entry.name)) bundleFiles.push(path)
      }
    }
    collectBundles(join(installed, 'lib'))
    const driveLetter = /(?:^|[^A-Za-z0-9])[A-Za-z]:[\\/]/m
    for (const file of bundleFiles.sort()) {
      const relative = file.slice(installed.length + 1).split(sep).join('/')
      const source = readFileSync(file, 'utf8')
      assert.ok(!driveLetter.test(source), 'absolute Windows path (drive letter) in shipped ' + relative)
      assert.ok(!source.includes(repoRoot), 'build root leaked into shipped ' + relative)
      assert.ok(!source.includes(installed), 'install path leaked into shipped ' + relative)
    }
    const clientBundle = join(installed, 'lib', 'client.js')
    const clientDigest = createHash('sha256').update(readFileSync(clientBundle)).digest('hex')
    console.log('  lib/client.js inside the package: sha256 ' + clientDigest + ', ' + statSync(clientBundle).size + ' B')
    ok(bundleFiles.length + ' shipped JS/map files carry no absolute path (no drive letter, no build root, no install path)')

    const { Context } = await import('@deepseek-ai/cordis')
    const { SkillRegistry } = await import('@deepseek-ai/dsh-skill')
    const { ToolRuntime } = await import('@deepseek-ai/dsh-tools')
    const plugin = await import(pathToFileURL(join(installed, 'lib', 'index.js')).href)
    const ctx = new Context()
    ctx.provide('systemPrompt', { tools: () => () => {}, section: () => () => {} })
    const skills = new SkillRegistry(ctx)
    const tools = new ToolRuntime(ctx)
    const workspaceRoot = join(root, 'workspace')
    await mkdir(workspaceRoot, { recursive: true })
    plugin.apply(ctx, { stateDir: '.academic-review', workspaceRoot })

    const toolNames = tools.schemas().map(schema => schema.name).sort()
    assert.deepEqual(toolNames, TOOL_NAMES, 'the installed package does not register the five review tools')
    ok('the installed package registers the five academic_review_* tools')

    const advertised = await skills.list({ cwd: workspaceRoot })
    const advertisedNames = advertised.map(skill => skill.name).sort()
    assert.deepEqual(advertisedNames, [...repoManifest.vendored.skills].sort(), 'advertised skills differ from the vendored set')
    for (const skill of advertised) {
      assert.equal(skill.provider, 'academic-review')
      assert.equal(typeof skill.path, 'string', skill.name + ' advertises no instruction path')
      // resourceBase is a { kind, path } descriptor, not a bare string.
      assert.equal(skill.resourceBase?.kind, 'directory', skill.name + ' advertises no directory resource base')
      const base = skill.resourceBase.path
      for (const [label, path] of [['instruction path', skill.path], ['resource base', base]]) {
        assert.ok(path.startsWith(installed + sep), skill.name + ' ' + label + ' resolves outside the installed package: ' + path)
        assert.ok(statSync(path).isDirectory() || statSync(path).isFile(), skill.name + ' ' + label + ' does not exist on disk: ' + path)
      }
      assert.ok(statSync(base).isDirectory(), skill.name + ' resource base is not a directory')
      assert.ok(readdirSync(base).includes('SKILL.md'), skill.name + ' has no SKILL.md in its resource base')
      assert.ok(
        readdirSync(base).some(entry => entry !== 'SKILL.md'),
        skill.name + ' ships a bare SKILL.md with none of its references, agents or templates',
      )
    }
    ok(
      advertised.length + ' skills advertised from the installed tree, each with an existing resource base inside it (' +
        advertisedNames.join(', ') + ')',
    )

    console.log('')
    console.log('=== PACK SMOKE SUMMARY ===')
    console.log('checks passed : ' + checks)
    console.log('tarball       : ' + humanSize(bytes) + ', ' + paths.length + ' entries, ' + vendored.length + ' vendored files')
    console.log('installed via : ' + installedVia)
    console.log('runtime       : ' + ((Date.now() - started) / 1000).toFixed(2) + 's')
    console.log('exit          : 0')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
}

await main()