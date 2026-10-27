#!/usr/bin/env node
/**
 * Build-determinism gate (pnpm test:build-determinism).
 *
 * Why this exists: lib/ is committed, so the bundle must be reproducible from
 * the sources alone. lightningcss hashes its `filename` into the CSS-modules
 * class prefix and rolldown prints module ids into `//#region` comments; if
 * either carries an absolute path, every clone builds a different lib/client.js
 * and "build then git diff --exit-code" stops meaning anything.
 *
 * What it does:
 *   1. builds the repo in place            -> lib/client.js (reference)
 *   2. copies the build inputs to a temp directory with a DIFFERENT absolute
 *      path (node_modules is linked, not copied) and builds there
 *   3. requires the two artifacts to be byte-identical, and requires neither
 *      bundle to contain an absolute path, a drive letter, or either root
 *   4. deletes the temp tree (pass --keep to inspect it)
 *
 * Exit codes: 0 = reproducible, 1 = the two builds differ or a path leaked,
 * 2 = a build itself failed. The script owns no state outside lib/ and the
 * temp directory, so it is safe to run in CI right before
 * `git diff --exit-code lib/`.
 */
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { cp, mkdtemp, readFile, rm, stat, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

/** Repository root, resolved from this file (never from cwd). */
const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')

/** Files and trees a build consumes. `lib/` is regenerated, never copied. */
const BUILD_INPUTS = [
  'package.json',
  'tsconfig.json',
  'tsconfig.client.json',
  'tsdown.config.ts',
  'src',
  'vendor',
  'vendor-manifest.json',
  'cordis.patch.yml',
]

/** Artifacts the gate compares byte for byte. */
const ARTIFACTS = ['lib/client.js', 'lib/client.js.map']

/** The artifact the task contract is about. */
const PRIMARY = 'lib/client.js'

/** Keep the temp tree for debugging. */
const KEEP = process.argv.includes('--keep')

/**
 * Hash one file.
 * @param path - file path.
 * @returns lowercase hex sha256.
 */
async function sha256Of(path) {
  return createHash('sha256').update(await readFile(path)).digest('hex')
}

/**
 * Run one build command, streaming nothing and failing hard on error.
 * @param cwd - build directory.
 * @param command - executable.
 * @param args - arguments.
 * @param label - step label for messages.
 */
function runStep(cwd, command, args, label) {
  // No shell: node is invoked directly, and a shell would split an
  // executable path that contains spaces.
  const result = spawnSync(command, args, { cwd, encoding: 'utf8' })
  if (result.status !== 0) {
    console.error('build-determinism: FAILED in ' + label)
    if (result.stdout) console.error(result.stdout.trim())
    if (result.stderr) console.error(result.stderr.trim())
    process.exit(2)
  }
}

/**
 * Run the three commands `pnpm build` runs, so the gate cannot drift from the
 * real build. The binaries are addressed through the build directory's
 * node_modules, which lets the copy reuse the installed dependencies.
 * @param cwd - build directory.
 */
function build(cwd) {
  const tsc = join(cwd, 'node_modules', 'typescript', 'bin', 'tsc')
  const tsdown = join(cwd, 'node_modules', 'tsdown', 'dist', 'run.mjs')
  runStep(cwd, process.execPath, [tsc, '-p', 'tsconfig.json'], cwd + ' (tsc host)')
  runStep(cwd, process.execPath, [tsc, '-p', 'tsconfig.client.json'], cwd + ' (tsc client)')
  runStep(cwd, process.execPath, [tsdown], cwd + ' (tsdown)')
}

/**
 * Reject any absolute path in one bundle: a drive letter, a POSIX root, or one
 * of the two build roots.
 * @param text - bundle text.
 * @param roots - absolute roots that must not appear.
 * @returns the offending pattern, or null.
 */
function absolutePathIn(text, roots) {
  const drive = /[A-Za-z]:[\\/]/.exec(text)
  if (drive !== null) return drive[0] + ' (drive-letter path)'
  for (const root of roots) {
    if (root === undefined || root === '') continue
    for (const form of [root, root.split('\\').join('/'), root.split('/').join('\\')]) {
      if (form !== '' && text.includes(form)) return form + ' (absolute build root)'
    }
  }
  return null
}

/**
 * Copy one build input into the temp tree.
 * @param relativePath - repo-relative input path.
 * @param target - temp build root.
 */
async function copyInput(relativePath, target) {
  const from = join(REPO_ROOT, relativePath)
  const to = join(target, relativePath)
  const info = await stat(from).catch(() => null)
  if (info === null) return
  await cp(from, to, { recursive: info.isDirectory() })
}

/**
 * Link (not copy) node_modules so the temp build resolves the same dependency
 * tree without a 100 MB copy.
 * @param target - temp build root.
 */
async function linkModules(target) {
  const source = join(REPO_ROOT, 'node_modules')
  const link = join(target, 'node_modules')
  try {
    await symlink(source, link, process.platform === 'win32' ? 'junction' : 'dir')
    return
  } catch (error) {
    // Fall back to a real copy; slower, but the gate still runs.
    console.warn('build-determinism: node_modules link failed (' + String(error) + '), copying instead')
    await cp(source, link, { recursive: true })
  }
}

/** Report both hashes and the verdict for one artifact. */
async function compareArtifact(relativePath, tempRoot, roots) {
  const localPath = join(REPO_ROOT, relativePath)
  const tempPath = join(tempRoot, relativePath)
  const localBytes = await readFile(localPath).catch(() => null)
  const tempBytes = await readFile(tempPath).catch(() => null)
  if (localBytes === null || tempBytes === null) {
    console.error('build-determinism: FAILED - missing artifact ' + relativePath
      + ' (repo: ' + String(localBytes !== null) + ', temp: ' + String(tempBytes !== null) + ')')
    process.exit(1)
  }
  const localHash = createHash('sha256').update(localBytes).digest('hex')
  const tempHash = createHash('sha256').update(tempBytes).digest('hex')
  console.log('  ' + relativePath)
  console.log('    ' + REPO_ROOT.padEnd(52) + ' ' + localHash + '  ' + String(localBytes.length) + ' B')
  console.log('    ' + tempRoot.padEnd(52) + ' ' + tempHash + '  ' + String(tempBytes.length) + ' B')
  if (localHash !== tempHash) {
    const text = localBytes.toString('utf8')
    const otherText = tempBytes.toString('utf8')
    let index
    const limit = Math.min(text.length, otherText.length)
    for (let position = 0; position < limit; position += 1) {
      if (text[position] !== otherText[position]) { index = position; break }
    }
    const from = index === undefined ? 0 : Math.max(0, index - 80)
    console.error('build-determinism: FAILED - ' + relativePath + ' differs between build roots')
    if (index !== undefined) {
      console.error('    first difference at byte ' + String(index))
      console.error('    repo: ' + JSON.stringify(text.slice(from, from + 160)))
      console.error('    temp: ' + JSON.stringify(otherText.slice(from, from + 160)))
    }
    process.exit(1)
  }
  const leaked = absolutePathIn(localBytes.toString('utf8'), roots)
  if (leaked !== null) {
    console.error('build-determinism: FAILED - ' + relativePath + ' embeds ' + leaked)
    process.exit(1)
  }
  return localHash
}

const referenceRoot = REPO_ROOT
console.log('build-determinism: building in place (' + referenceRoot + ')')
build(REPO_ROOT)

const tempRoot = await mkdtemp(join(tmpdir(), 'dsh-academic-review-determinism-'))
console.log('build-determinism: building a second copy at ' + tempRoot)
try {
  for (const input of BUILD_INPUTS) await copyInput(input, tempRoot)
  await linkModules(tempRoot)
  build(tempRoot)

  console.log('build-determinism: comparing artifacts')
  const hashes = {}
  for (const artifact of ARTIFACTS) hashes[artifact] = await compareArtifact(artifact, tempRoot, [referenceRoot, tempRoot])
  const primary = hashes[PRIMARY]
  console.log('build-determinism: PASS - ' + PRIMARY + ' sha256 ' + primary
    + ' is identical from both build roots and carries no absolute path')
} finally {
  if (KEEP) {
    console.log('build-determinism: kept ' + tempRoot)
  } else {
    await rm(tempRoot, { recursive: true, force: true, maxRetries: 3 })
  }
}
