#!/usr/bin/env node
/**
 * Vendor the upstream Academic Research Skills (ARS) reviewer skill into
 * `vendor/`, byte-identically, and record the SHA-256 of every vendored file in
 * `vendor-manifest.json`.
 *
 * Usage:
 *   node scripts/vendor-upstream.mjs --upstream <path to an ARS checkout>
 *   node scripts/vendor-upstream.mjs --upstream <path> --check   # verify only
 *
 * Hard rules (docs/PORT_SPEC.md §1):
 * - The whole `academic-paper-reviewer/` tree is copied unmodified.
 * - Only the `shared/` files the reviewer tree actually references are copied
 *   (grep-verified list below).
 * - Nothing is edited after copying: no BOM stripping, no line-ending
 *   normalization, no frontmatter rewriting.
 */
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { dirname, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const vendorRoot = join(repoRoot, 'vendor')
const manifestPath = join(repoRoot, 'vendor-manifest.json')

/** Upstream skill tree vendored in full (28 files at commit 1ec249df). */
const SKILL_DIR = 'academic-paper-reviewer'

/**
 * The `shared/` files referenced verbatim by the vendored reviewer tree, plus
 * the legacy re-review contracts the current re-review protocol points at.
 * Paths are upstream-relative so vendored links keep resolving.
 */
const SHARED_FILES = [
  'shared/ground_truth_isolation_pattern.md',
  'shared/handoff_schemas.md',
  'shared/mode_spectrum.md',
  'shared/model_tiering.md',
  'shared/cross_model_verification.md',
  'shared/sprint_contract.schema.json',
  'shared/references/routing_core.md',
  'shared/references/intent_clarification_protocol.md',
  'shared/references/review_criteria_consumer_protocol.md',
  'shared/contracts/reviewer/full.json',
  'shared/contracts/reviewer/methodology_focus.json',
  'shared/contracts/reviewer/review_panel_provenance.schema.json',
  'shared/contracts/reviewer/review_panel_provenance_carrier.schema.json',
  'shared/contracts/reviewer/review_panel_provenance_input.schema.json',
  'shared/contracts/revision/revision_roadmap.schema.json',
  'shared/contracts/re_review/input_manifest.schema.json',
  'shared/contracts/re_review/precommitment.schema.json',
  'shared/contracts/re_review/traceability.schema.json',
  'shared/contracts/re_review/verdict_record.schema.json',
  'shared/contracts/re_review/legacy/v1_0/input_manifest.schema.json',
  'shared/contracts/re_review/legacy/v1_0/precommitment.schema.json',
  'shared/contracts/re_review/legacy/v1_0/traceability.schema.json',
  'shared/contracts/re_review/legacy/v1_0/verdict_record.schema.json',
  // Review-target criteria binding closure (#684): the consumer protocol above
  // names these schemas, the registry, and the registry's source receipts.
  'shared/contracts/review_target/constructive_review_findings.schema.json',
  'shared/contracts/review_target/criteria_registry.schema.json',
  'shared/contracts/review_target/review_criteria_binding_manifest.schema.json',
  'shared/contracts/review_target/review_criteria_source_receipt.schema.json',
  'shared/contracts/review_target/review_target_context.schema.json',
  'shared/contracts/review_target/review_target_declaration.schema.json',
  'shared/review_criteria_registry.json',
  'shared/review_criteria_sources/msr-2027-technical-papers.2026-08-24.json',
  'shared/review_criteria_sources/sigsoft-empirical-standards.2026-08-24.json',
]

/** Attribution pinned by docs/PORT_SPEC.md §5. */
export const UPSTREAM = {
  skill: 'academic-paper-reviewer',
  skillVersion: '1.11.1',
  repository: 'https://github.com/Imbad0202/academic-research-skills',
  commit: '1ec249df98728682dfbbdfb940a658338bfd6f80',
  author: 'Cheng-I Wu',
  orcid: 'https://orcid.org/0009-0008-9523-0103',
  license: 'CC BY-NC 4.0',
}

function sha256(buffer) {
  return createHash('sha256').update(buffer).digest('hex')
}

async function listFiles(root, base = root) {
  const out = []
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const path = join(root, entry.name)
    if (entry.isDirectory()) out.push(...(await listFiles(path, base)))
    else if (entry.isFile()) out.push(relative(base, path).split(sep).join('/'))
  }
  return out.sort()
}

/** Bytes exactly as the upstream REPOSITORY stores them, never a worktree copy. */
function repoBytes(upstreamRoot, relPath, commit) {
  try {
    return execFileSync('git', ['-C', upstreamRoot, 'cat-file', 'blob', commit + ':' + relPath], { maxBuffer: 1 << 27 })
  } catch (error) {
    throw new Error('cannot read ' + relPath + ' at ' + commit + ' from ' + upstreamRoot + ': ' + (error?.message || error))
  }
}

/** The skill tree as committed upstream, not as this machine checked it out. */
function skillFileList(upstreamRoot, commit) {
  const listing = execFileSync(
    'git',
    ['-C', upstreamRoot, 'ls-tree', '-r', '--name-only', commit, '--', SKILL_DIR],
    { encoding: 'utf8', maxBuffer: 1 << 27 },
  )
  return listing.split('\n').map(line => line.trim()).filter(line => line.length > 0)
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

/** Folding CRLF to LF, used only to recognise the git checkout filter. */
function foldCrlf(buffer) {
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
function assertWorktreeClean(upstreamRoot, relPath, bytes) {
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

async function verify() {
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'))
  let bad = 0
  for (const [file, expected] of Object.entries(manifest.files)) {
    let actual
    try {
      actual = sha256(await readFile(join(vendorRoot, file)))
    } catch {
      actual = 'missing'
    }
    if (actual !== expected) {
      bad += 1
      console.error('MISMATCH ' + file + ': expected ' + expected + ', got ' + actual)
    }
  }
  const present = await listFiles(vendorRoot)
  const extra = present.filter(file => manifest.files[file] === undefined)
  for (const file of extra) {
    bad += 1
    console.error('UNEXPECTED ' + file + ' (not in vendor-manifest.json)')
  }
  if (bad > 0) {
    console.error('verify-vendor: ' + bad + ' problem(s)')
    process.exitCode = 1
    return
  }
  console.log('verify-vendor: ' + Object.keys(manifest.files).length + ' files byte-identical to vendor-manifest.json')
}

async function vendor(upstream) {
  if (upstream === undefined) {
    console.error('usage: node scripts/vendor-upstream.mjs --upstream <ARS checkout> [--check]')
    process.exitCode = 2
    return
  }
  const upstreamRoot = resolve(upstream)
  const commit = resolveUpstreamCommit(upstreamRoot)
  const entries = [...skillFileList(upstreamRoot, commit), ...SHARED_FILES].sort()

  const files = {}
  const filtered = []
  const bodies = []
  for (const relPath of entries) {
    const bytes = repoBytes(upstreamRoot, relPath, commit)
    const { filtered: wasFiltered } = assertWorktreeClean(upstreamRoot, relPath, bytes)
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

  const skillFiles = entries.filter(relPath => relPath.startsWith(SKILL_DIR + '/'))
  const manifest = {
    schemaVersion: 1,
    upstream: UPSTREAM,
    vendored: {
      skillDir: 'vendor/' + SKILL_DIR,
      skillFileCount: skillFiles.length,
      sharedFileCount: SHARED_FILES.length,
      totalFileCount: entries.length,
    },
    sharedFiles: SHARED_FILES,
    files,
  }
  await writeFile(manifestPath, JSON.stringify(manifest, null, 2) + '\n')
  console.log(
    'vendored ' + skillFiles.length + ' skill files + ' + SHARED_FILES.length + ' shared files from ' + commit + ' (repository bytes)' +
      (filtered.length > 0 ? '; ' + filtered.length + ' worktree cop' + (filtered.length === 1 ? 'y' : 'ies') + ' had filtered line endings and were read from git' : ''),
  )
}

async function main(argv) {
  const { upstream, check } = parseArgs(argv)
  if (check) return verify()
  return vendor(upstream)
}

export { SHARED_FILES, SKILL_DIR, foldCrlf, repoBytes, skillFileList, resolveUpstreamCommit, assertWorktreeClean, sha256, main }

const invokedDirectly = process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href
if (invokedDirectly) await main(process.argv.slice(2))
