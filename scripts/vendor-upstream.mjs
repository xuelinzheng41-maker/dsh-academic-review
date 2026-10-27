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
import { createHash } from 'node:crypto'
import { cp, mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { dirname, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

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

async function hashTree(root) {
  const files = await listFiles(root)
  const hashes = {}
  for (const file of files) hashes[file] = sha256(await readFile(join(root, file)))
  return hashes
}

function parseArgs(argv) {
  let upstream
  let check = false
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--upstream') upstream = argv[++i]
    else if (argv[i] === '--check') check = true
    else throw new Error('unknown argument: ' + argv[i])
  }
  return { upstream, check }
}

const { upstream, check } = parseArgs(process.argv.slice(2))

if (check) {
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
    process.exit(1)
  }
  console.log('verify-vendor: ' + Object.keys(manifest.files).length + ' files byte-identical to vendor-manifest.json')
  process.exit(0)
}

if (upstream === undefined) {
  console.error('usage: node scripts/vendor-upstream.mjs --upstream <ARS checkout> [--check]')
  process.exit(2)
}

const upstreamRoot = resolve(upstream)
await stat(join(upstreamRoot, SKILL_DIR, 'SKILL.md'))

await rm(vendorRoot, { recursive: true, force: true })
await mkdir(vendorRoot, { recursive: true })
await cp(join(upstreamRoot, SKILL_DIR), join(vendorRoot, SKILL_DIR), { recursive: true, dereference: false })
for (const file of SHARED_FILES) {
  const target = join(vendorRoot, file)
  await mkdir(dirname(target), { recursive: true })
  await cp(join(upstreamRoot, file), target)
}

const files = await hashTree(vendorRoot)
const skillFiles = await hashTree(join(vendorRoot, SKILL_DIR))
const manifest = {
  schemaVersion: 1,
  upstream: UPSTREAM,
  vendored: {
    skillDir: 'vendor/' + SKILL_DIR,
    skillFileCount: Object.keys(skillFiles).length,
    sharedFileCount: SHARED_FILES.length,
    totalFileCount: Object.keys(files).length,
  },
  sharedFiles: SHARED_FILES,
  files,
}
await writeFile(manifestPath, JSON.stringify(manifest, null, 2) + '\n')
console.log('vendored ' + Object.keys(skillFiles).length + ' skill files + ' + SHARED_FILES.length + ' shared files into vendor/')
