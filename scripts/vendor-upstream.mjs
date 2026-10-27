#!/usr/bin/env node
/**
 * Vendor the upstream Academic Research Skills (ARS) skills into `vendor/`,
 * byte-identically, and record the SHA-256 of every vendored file in
 * `vendor-manifest.json`.
 *
 * Usage:
 *   node scripts/vendor-upstream.mjs --upstream <path to an ARS checkout>
 *   node scripts/vendor-upstream.mjs --upstream <path> --check   # verify only
 *
 * Hard rules (docs/PORT_SPEC.md section 1):
 * - Every skill in SKILLS is copied in full and unmodified.
 * - The shared/ closure is COMPUTED from the vendored trees: every `shared/...`
 *   path they mention, plus whatever those shared files mention themselves, until
 *   nothing new turns up. There is no hand-maintained file list to rot.
 * - Bytes come from the git object store of the upstream checkout
 *   (`git cat-file blob <commit>:<path>`), never from the worktree: a checkout
 *   with core.autocrlf=true rewrites LF to CRLF on disk, and pinning that would
 *   pin this machine instead of upstream. Nothing is normalised before hashing.
 * - The upstream checkout must be at UPSTREAM.commit; anything else is refused.
 * - A referenced `shared/...` target that does not exist upstream fails the run.
 */
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const vendorRoot = join(repoRoot, 'vendor')
const manifestPath = join(repoRoot, 'vendor-manifest.json')

/** Skill trees vendored in full. Adding a skill is a one-line change here. */
const SKILLS = ['academic-paper-reviewer', 'deep-research', 'academic-paper', 'sr-screener']

/** Attribution pinned by docs/PORT_SPEC.md section 5. */
export const UPSTREAM = {
  skill: 'academic-paper-reviewer',
  skillVersion: '1.11.1',
  repository: 'https://github.com/Imbad0202/academic-research-skills',
  commit: '1ec249df98728682dfbbdfb940a658338bfd6f80',
  author: 'Cheng-I Wu',
  orcid: 'https://orcid.org/0009-0008-9523-0103',
  license: 'CC BY-NC 4.0',
}

/** `shared/<path>` mentions, in markdown links, code spans and bare prose alike. */
/** The review-criteria registry: the document provenance receipts have to justify. */
const REGISTRY_PATH = 'shared/review_criteria_registry.json'
/** Provenance receipts. A file here is vendored only if the registry cites it. */
const RECEIPT_DIR = 'shared/review_criteria_sources'

const SHARED_REF = /shared\/[A-Za-z0-9._\-/]+/g
/** A reference that runs into a template placeholder (`shared/contracts/<d>/<m>.json`). */
const PLACEHOLDER = /^[<{[[$|*]/
/** Trailing punctuation that is never part of a path. */
const TRAILING = /[.,);:'"\]}>*]+$/
/** A filename-shaped token, resolved relative to its own file or to shared/. */
const RELATIVE_REF = /[A-Za-z0-9._\-]+(?:\/[A-Za-z0-9._\-]+)*\.(?:md|json|ya?ml|txt)/g

function sha256(buffer) {
  return createHash('sha256').update(buffer).digest('hex')
}

function parseArgs(argv) {
  let upstream
  let check = false
  for (let i = 0; i < argv.length; i += 1) {
    // 'pnpm run <script> -- ...' forwards the separator itself on pnpm 11.
    if (argv[i] === '--') continue
    if (argv[i] === '--upstream') upstream = argv[++i]
    else if (argv[i] === '--check') check = true
    else throw new Error('unknown argument: ' + argv[i])
  }
  return { upstream, check }
}

/** Bytes exactly as the upstream REPOSITORY stores them, never a worktree copy. */
function repoBytes(upstreamRoot, relPath, commit) {
  try {
    return execFileSync('git', ['-C', upstreamRoot, 'cat-file', 'blob', commit + ':' + relPath], { maxBuffer: 1 << 27 })
  } catch (error) {
    throw new Error('cannot read ' + relPath + ' at ' + commit + ' from ' + upstreamRoot + ': ' + (error?.message || error))
  }
}

function resolveUpstreamCommit(upstreamRoot) {
  let head
  try {
    head = execFileSync('git', ['-C', upstreamRoot, 'rev-parse', 'HEAD'], {
      encoding: 'utf8',
      maxBuffer: 1 << 20,
      stdio: ['ignore', 'pipe', 'pipe'],
    }).trim()
  } catch (error) {
    throw new Error(
      upstreamRoot +
        ' is not a git checkout, so the repository bytes cannot be recovered from it. ' +
        'Vendoring a plain directory would copy whatever the worktree holds (core.autocrlf rewrites ' +
        'line endings on checkout) and the pins would describe this machine instead of upstream. ' +
        'Clone the upstream repository and check out the pinned commit.',
    )
  }
  if (head !== UPSTREAM.commit) {
    throw new Error(
      'upstream HEAD is ' + head + ' but UPSTREAM.commit is ' + UPSTREAM.commit + '; check out the pinned commit before vendoring',
    )
  }
  return head
}

/**
 * An index of the upstream commit: every path, so existence checks cost nothing
 * and a missing reference can be reported precisely.
 */
function repoIndex(upstreamRoot, commit) {
  const listing = execFileSync('git', ['-C', upstreamRoot, 'ls-tree', '-r', '--name-only', commit], {
    encoding: 'utf8',
    maxBuffer: 1 << 27,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  const files = listing.split('\n').map(line => line.trim()).filter(line => line.length > 0)
  const fileSet = new Set(files)
  const dirSet = new Set()
  for (const file of files) {
    const parts = file.split('/')
    for (let i = 1; i < parts.length; i += 1) dirSet.add(parts.slice(0, i).join('/'))
  }
  const textCache = new Map()
  return {
    files: fileSet,
    dirs: dirSet,
    typeOf: path => (fileSet.has(path) ? 'file' : dirSet.has(path) ? 'dir' : 'missing'),
    filesUnder: dir => files.filter(file => file.startsWith(dir + '/')),
    filesUnderSkill: skill => files.filter(file => file.startsWith(skill + '/')),
    readText: path => {
      if (!textCache.has(path)) textCache.set(path, repoBytes(upstreamRoot, path, commit).toString('utf8'))
      return textCache.get(path)
    },
  }
}

/**
 * Compute the shared/ closure of a set of skill trees.
 *
 * Every `shared/...` mention is followed: a file is vendored, a directory is
 * expanded to the files it holds (the re-review and review-target contract
 * families are referenced that way), and a mention that runs into a template
 * placeholder is ignored. Files that are themselves inside shared/ may also name
 * siblings by plain filename, so those are resolved relative to the file and to
 * shared/ as well. Iteration continues until nothing new appears - there is one
 * level of "legacy paths those files reference" in practice, but the fixpoint
 * means a deeper chain cannot silently drop a file.
 *
 * Returns the closure plus everything it could not resolve, so the caller can
 * fail loudly instead of writing a manifest with a hole in it.
 */
export function computeSharedClosure({ skillFiles, readText, typeOf, filesUnder, maxRounds = 8 }) {
  const included = new Set()
  const missing = new Set()
  const expandedDirs = new Map()
  const visited = new Set()
  let queue = [...skillFiles]

  for (let round = 0; queue.length > 0 && round < maxRounds; round += 1) {
    const next = []
    for (const file of queue) {
      if (visited.has(file)) continue
      visited.add(file)
      const text = readText(file)

      for (const match of text.matchAll(SHARED_REF)) {
        const after = text.slice(match.index + match[0].length, match.index + match[0].length + 1)
        if (PLACEHOLDER.test(after)) continue
        const trimmed = match[0].replace(TRAILING, '')
        const isDir = trimmed.endsWith('/')
        const path = trimmed.replace(/\/+$/, '')
        if (path === 'shared' || path === '') continue
        const kind = typeOf(path)
        if (kind === 'missing') {
          missing.add(path + (isDir ? '/' : ''))
          continue
        }
        if (kind === 'dir') {
          if (expandedDirs.has(path)) continue
          const held = filesUnder(path)
          expandedDirs.set(path, held.length)
          for (const held_file of held) {
            if (included.has(held_file)) continue
            included.add(held_file)
            next.push(held_file)
          }
          continue
        }
        if (included.has(path)) continue
        included.add(path)
        next.push(path)
      }

      if (!file.startsWith('shared/')) continue
      const ownDir = file.includes('/') ? file.slice(0, file.lastIndexOf('/')) : ''
      for (const match of text.matchAll(RELATIVE_REF)) {
        const reference = match[0].replace(TRAILING, '')
        for (const base of [ownDir + '/', 'shared/']) {
          const candidate = (base + reference).replace(/\/{2,}/g, '/')
          if (typeOf(candidate) !== 'file' || included.has(candidate)) continue
          included.add(candidate)
          next.push(candidate)
        }
      }
    }
    queue = next
  }

  return {
    sharedFiles: [...included].sort(),
    missing: [...missing].sort(),
    expandedDirs: [...expandedDirs.entries()].map(([dir, count]) => ({ dir, count })).sort((a, b) => a.dir.localeCompare(b.dir)),
  }
}

/** Every criterion_id value in a parsed document, collected at any depth. */
export function criterionIds(document, found = new Set()) {
  if (Array.isArray(document)) {
    for (const item of document) criterionIds(item, found)
    return found
  }
  if (document === null || typeof document !== 'object') return found
  for (const [key, value] of Object.entries(document)) {
    if (key === 'criterion_id' && typeof value === 'string') found.add(value)
    else criterionIds(value, found)
  }
  return found
}

/**
 * Vendor a provenance receipt only when the review-criteria registry cites it.
 *
 * Nothing names these files by path - the link is by criterion id, which no path
 * scan can see - so a receipt whose ids the registry cites is evidence the vendored
 * registry depends on, and a receipt nobody cites is just an extra file. Ids are
 * read from criterion_id keys in the parsed JSON, so prose cannot satisfy the rule.
 */
export function computeRegistryReceipts({ receiptFiles, readText, registryFile = REGISTRY_PATH }) {
  const registryIds = criterionIds(JSON.parse(readText(registryFile)))
  const included = []
  const excluded = []
  for (const file of [...receiptFiles].sort()) {
    const ids = [...criterionIds(JSON.parse(readText(file)))].sort()
    const cited = ids.filter(id => registryIds.has(id))
    if (cited.length > 0) {
      included.push({ file, criterionIds: cited })
      continue
    }
    excluded.push({
      file,
      criterionIds: ids,
      reason:
        ids.length === 0
          ? 'it names no criterion_id, so it justifies nothing in ' + registryFile
          : 'none of its criterion ids (' + ids.join(', ') + ') appear in ' + registryFile,
    })
  }
  return { included, excluded, registryCriterionIds: registryIds.size }
}

/** Files the previous manifest pinned that the rules no longer reach: never dropped silently. */
export function droppedPins(previousFiles, currentFiles) {
  const current = new Set(currentFiles)
  return [...new Set(previousFiles)].filter(file => !current.has(file)).sort()
}

async function listFiles(root, base = root) {
  const out = []
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const path = join(root, entry.name)
    if (entry.isDirectory()) out.push(...(await listFiles(path, base)))
    else if (entry.isFile()) out.push(path.slice(base.length + 1).split('\\').join('/'))
  }
  return out.sort()
}

/**
 * Verify a vendored tree against a manifest.
 *
 * Exported because the packaged-tarball smoke test has to run exactly this check
 * against the INSTALLED copy: the working tree passing proves nothing about what
 * the files field and .npmignore actually put inside the tarball.
 *
 * @param input - vendorRoot and manifestPath to check (defaults are the repo's).
 * @returns the pinned file count plus every problem found, so callers choose how to report.
 */
export async function verifyVendorTree({ vendorRoot: vendorBase, manifestPath: manifestFile }) {
  const manifest = JSON.parse(await readFile(manifestFile, 'utf8'))
  const problems = []
  for (const [file, expected] of Object.entries(manifest.files)) {
    let actual
    try {
      actual = sha256(await readFile(join(vendorBase, file)))
    } catch {
      actual = 'missing'
    }
    if (actual !== expected) problems.push({ kind: 'mismatch', file, detail: 'expected ' + expected + ', got ' + actual })
  }
  let present = []
  try {
    present = await listFiles(vendorBase)
  } catch {
    problems.push({ kind: 'missing-tree', file: vendorBase, detail: 'the vendored tree is not there at all' })
  }
  for (const file of present) {
    if (manifest.files[file] === undefined) problems.push({ kind: 'unexpected', file, detail: 'not in vendor-manifest.json' })
  }
  return { fileCount: Object.keys(manifest.files).length, problems }
}

async function verify() {
  const { fileCount, problems } = await verifyVendorTree({ vendorRoot, manifestPath })
  for (const problem of problems) {
    console.error((problem.kind === 'mismatch' ? 'MISMATCH ' : 'UNEXPECTED ') + problem.file + ': ' + problem.detail)
  }
  if (problems.length > 0) {
    console.error('verify-vendor: ' + problems.length + ' problem(s)')
    process.exitCode = 1
    return
  }
  console.log('verify-vendor: ' + fileCount + ' files byte-identical to vendor-manifest.json')
}

async function previousManifest() {
  try {
    return JSON.parse(await readFile(manifestPath, 'utf8'))
  } catch {
    return undefined
  }
}

async function vendor(upstream) {
  if (upstream === undefined) {
    console.error('usage: node scripts/vendor-upstream.mjs --upstream <ARS checkout> [--check]')
    process.exitCode = 2
    return
  }
  const upstreamRoot = resolve(upstream)
  const commit = resolveUpstreamCommit(upstreamRoot)
  const index = repoIndex(upstreamRoot, commit)

  const skillTrees = new Map()
  for (const skill of SKILLS) {
    const files = index.filesUnderSkill(skill)
    if (files.length === 0) throw new Error('skill ' + skill + ' is not present at ' + commit + ' in ' + upstreamRoot)
    skillTrees.set(skill, files)
  }

  const closure = computeSharedClosure({
    skillFiles: [...skillTrees.values()].flat(),
    readText: index.readText,
    typeOf: index.typeOf,
    filesUnder: index.filesUnder,
  })
  assertClosureComplete(closure, commit)

  // Two rules decide what is vendored under shared/, and both are computed:
  //   1. the path scan above, which stays closed - an unreferenced file stays out;
  //   2. provenance receipts the registry cites by criterion id. Nothing names
  //      those files by path, so the scan cannot see the link, and dropping them
  //      would ship a registry whose criteria claim provenance we do not vendor.
  const receiptFiles = index.filesUnder(RECEIPT_DIR).sort()
  const receipts =
    receiptFiles.length === 0
      ? { included: [], excluded: [], registryCriterionIds: 0 }
      : computeRegistryReceipts({ receiptFiles, readText: index.readText, registryFile: REGISTRY_PATH })
  const scanned = new Set(closure.sharedFiles)
  const viaReceipts = receipts.included.map(entry => entry.file).filter(file => !scanned.has(file))
  const sharedFiles = [...new Set([...closure.sharedFiles, ...viaReceipts])].sort()
  const sharedByScan = sharedFiles.filter(file => scanned.has(file)).length
  const sharedByReceipt = sharedFiles.length - sharedByScan
  // Compared against what the previous manifest pinned, so a file leaving the
  // vendored set is always printed instead of vanishing with a rule change.
  const previous = await previousManifest()
  const dropped = droppedPins(Array.isArray(previous?.sharedFiles) ? previous.sharedFiles : [], sharedFiles)

  const entries = [...skillTrees.values()].flat().concat(sharedFiles).sort()
  const files = {}
  const filtered = []
  const bodies = []
  for (const relPath of entries) {
    const bytes = repoBytes(upstreamRoot, relPath, commit)
    const { filtered: wasFiltered } = assertWorktreeClean(upstreamRoot, relPath, bytes, index)
    if (wasFiltered) filtered.push(relPath)
    bodies.push([relPath, bytes])
    files[relPath] = sha256(bytes)
  }

  await rm(vendorRoot, { recursive: true, force: true })
  await mkdir(vendorRoot, { recursive: true })
  for (const [relPath, bytes] of bodies) {
    const target = join(vendorRoot, relPath)
    await mkdir(dirname(target), { recursive: true })
    await writeFile(target, bytes)
  }

  const skillFileCounts = {}
  for (const [skill, skillFiles] of skillTrees) skillFileCounts[skill] = skillFiles.length
  const manifest = {
    schemaVersion: 2,
    upstream: UPSTREAM,
    vendored: {
      skillDir: 'vendor',
      skills: SKILLS,
      skillFileCounts,
      skillFileCount: [...skillTrees.values()].reduce((sum, skillFiles) => sum + skillFiles.length, 0),
      sharedFileCount: sharedFiles.length,
      sharedFileCounts: { byScan: sharedByScan, byRegistryReceipt: sharedByReceipt },
      totalFileCount: entries.length,
    },
    skills: SKILLS.map(skill => ({ name: skill, dir: 'vendor/' + skill, fileCount: skillFileCounts[skill] })),
    sharedFiles,
    sharedViaRegistryReceipts: receipts.included,
    files,
  }
  await writeFile(manifestPath, JSON.stringify(manifest, null, 2) + '\n')

  console.log(
    'vendored ' +
      SKILLS.map(skill => skill + ': ' + skillFileCounts[skill] + ' files').join(' + ') +
      ' + ' + sharedFiles.length + ' shared files = ' + entries.length + ' files from ' + commit + ' (repository bytes)',
  )
  console.log(
    'shared closure: ' + closure.sharedFiles.length + ' scanned' +
      (closure.expandedDirs.length > 0 ? ', ' + closure.expandedDirs.map(entry => entry.dir + ' (' + entry.count + ')').join(', ') : ''),
  )
  console.log(
    'shared by rule: ' + sharedByScan + ' by scan + ' + sharedByReceipt + ' by registry receipt = ' + sharedFiles.length,
  )
  for (const entry of receipts.included) {
    console.log(
      '  receipt ' + entry.file + ' <- ' + REGISTRY_PATH + ' cites ' + entry.criterionIds.length + ' of its criterion ids: ' + entry.criterionIds.join(', '),
    )
  }
  for (const entry of receipts.excluded) console.warn('  NOT vendored ' + entry.file + ': ' + entry.reason)
  for (const file of dropped) console.warn('  NO LONGER VENDORED (was pinned by the previous manifest): ' + file)
  if (filtered.length > 0) console.log(filtered.length + ' worktree copies had filtered line endings and were read from git')
}

/**
 * Refuse to write anything when a vendored tree points at a shared/ path the
 * upstream commit does not contain.
 *
 * A dangling reference is not a cosmetic warning: the closure would ship a skill
 * whose own instructions name a file that is not there, and the next reader would
 * find a hole with no record of why. So the run stops before anything is written.
 */
export function assertClosureComplete(closure, commit) {
  if (closure.missing.length === 0) return
  throw new Error(
    'the vendored trees reference ' + closure.missing.length + ' shared/ path(s) that do not exist at ' + commit + ':\n  ' +
      closure.missing.join('\n  ') +
      '\nA reference that cannot be resolved means the closure is wrong, so nothing was written.',
  )
}

export function foldCrlf(buffer) {
  return Buffer.from(buffer.toString('binary').replace(/\r\n/g, '\n'), 'binary')
}

/**
 * Refuse to vendor a file whose worktree copy disagrees with the commit.
 *
 * A CRLF/LF difference is exactly what core.autocrlf produces on checkout, and
 * it is why the repository bytes are read with git instead of from disk. Anything
 * else means the checkout was edited, and pinning it would silently vendor
 * something upstream never published.
 */
function assertWorktreeClean(upstreamRoot, relPath, bytes, index) {
  let onDisk
  try {
    onDisk = readFileSync(join(upstreamRoot, relPath))
  } catch {
    return { filtered: false }
  }
  if (onDisk.equals(bytes)) return { filtered: false }
  if (foldCrlf(onDisk).equals(bytes)) return { filtered: true }
  throw new Error(
    'the worktree copy of ' + relPath + ' differs from the commit beyond line endings; commit or discard the local edits first',
  )
}

async function main(argv) {
  const { upstream, check } = parseArgs(argv)
  if (check) return verify()
  return vendor(upstream)
}

export { SKILLS, assertWorktreeClean, repoBytes, resolveUpstreamCommit, sha256, main }

const invokedDirectly = process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href
if (invokedDirectly) await main(process.argv.slice(2))