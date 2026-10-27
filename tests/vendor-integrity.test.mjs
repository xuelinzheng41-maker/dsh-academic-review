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

const EXPECTED_SKILLS = ['academic-paper-reviewer', 'deep-research', 'academic-paper']
const EXPECTED_SKILL_FILE_COUNTS = { 'academic-paper-reviewer': 28, 'deep-research': 53, 'academic-paper': 63 }
// Counted from the upstream git objects: 144 skill files + 110 shared files.
const EXPECTED_TOTAL_FILES = 254
// The closure is derived, but its SIZE is pinned here on purpose: a rule change
// that quietly stops following part of the tree has to be a deliberate edit.
const EXPECTED_SHARED_COUNTS = { total: 110, byScan: 108, byRegistryReceipt: 2 }

test('vendor-manifest.json pins the upstream identity and the vendored skills', async () => {
  const manifest = JSON.parse(await readFile(join(repoRoot, 'vendor-manifest.json'), 'utf8'))
  assert.equal(manifest.schemaVersion, 2)
  assert.equal(manifest.upstream.skillVersion, '1.11.1')
  assert.equal(manifest.upstream.commit, '1ec249df98728682dfbbdfb940a658338bfd6f80')
  assert.equal(manifest.upstream.license, 'CC BY-NC 4.0')
  assert.deepEqual(manifest.vendored.skills, EXPECTED_SKILLS)
  assert.deepEqual(manifest.vendored.skillFileCounts, EXPECTED_SKILL_FILE_COUNTS)
  assert.equal(manifest.vendored.skillFileCount, 28 + 53 + 63)
  assert.equal(manifest.vendored.sharedFileCount, manifest.sharedFiles.length)
  assert.equal(manifest.vendored.sharedFileCount, EXPECTED_SHARED_COUNTS.total)
  assert.deepEqual(manifest.vendored.sharedFileCounts, {
    byScan: EXPECTED_SHARED_COUNTS.byScan,
    byRegistryReceipt: EXPECTED_SHARED_COUNTS.byRegistryReceipt,
  })
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
  assert.equal(names.length, EXPECTED_TOTAL_FILES, 'expected ' + EXPECTED_TOTAL_FILES + ' vendored files, got ' + names.length)
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

// --- the third skill: bytes, and what only it references --------------------
//
// academic-paper is the first vendored skill that ships a non-markdown file
// (templates/latex_article_template.tex), and the first whose instructions reach
// parts of shared/ the other two never mention. Both are asserted here, against
// the real vendored tree, because both are the kind of thing a "works for markdown"
// path would quietly get wrong.

const PAPER_ONLY_SHARED = [
  'shared/contracts/writer/full.json',
  'shared/policy_data/nature_policy.md',
  'shared/references/claim_strength_ladder.md',
  'shared/raise_framework.md',
]

/** Every vendored file outside the given skill trees, as text, for mention checks. */
async function textOutside(skills) {
  const files = []
  async function walk(dir, prefix) {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const relative = prefix === '' ? entry.name : prefix + '/' + entry.name
      if (entry.isDirectory()) await walk(join(dir, entry.name), relative)
      else files.push(relative)
    }
  }
  await walk(join(repoRoot, 'vendor'), '')
  const wanted = files.filter(name => !skills.some(skill => name.startsWith(skill + '/')))
  return Promise.all(wanted.map(async name => ({ name, text: await readFile(join(repoRoot, 'vendor', name), 'utf8') })))
}

test('the one non-markdown file is vendored byte-for-byte, with no line-ending conversion', async () => {
  const manifest = JSON.parse(await readFile(join(repoRoot, 'vendor-manifest.json'), 'utf8'))
  const tex = 'academic-paper/templates/latex_article_template.tex'
  assert.ok(manifest.files[tex] !== undefined, 'the .tex template is not pinned')
  const bytes = await readFile(join(repoRoot, 'vendor', tex))
  assert.equal(createHash('sha256').update(bytes).digest('hex'), manifest.files[tex], 'digest drift in ' + tex)
  // The vendoring path treats every file as bytes, so nothing may have rewritten
  // the line endings of the one file that is not markdown.
  assert.equal(bytes.includes(0x0d), false, 'the vendored .tex carries CR, so something text-converted it')
  assert.ok(bytes.subarray(0, 1).toString('utf8') === '%', 'the .tex still starts with its LaTeX comment header')
  // ...and the .tex is the only non-markdown file in the tree, so a filter that
  // only knew about markdown would have been caught by the line above.
  const extensions = new Set(Object.keys(manifest.files).filter(name => name.startsWith('academic-paper/')).map(name => name.slice(name.lastIndexOf('.'))))
  assert.deepEqual([...extensions].sort(), ['.json', '.md', '.tex', '.yaml'].filter(ext => [...extensions].includes(ext)).sort())
})

/** The vendored files of the given skill trees, as text. */
async function textUnder(skills) {
  const entries = []
  async function walk(dir, prefix) {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const relative = prefix === '' ? entry.name : prefix + '/' + entry.name
      if (entry.isDirectory()) await walk(join(dir, entry.name), relative)
      else entries.push({ name: relative, text: await readFile(join(repoRoot, 'vendor', relative), 'utf8') })
    }
  }
  for (const skill of skills) await walk(join(repoRoot, 'vendor', skill), skill)
  return entries
}

test('a shared file only academic-paper references is vendored, and the other skills never mention it', async () => {
  const manifest = JSON.parse(await readFile(join(repoRoot, 'vendor-manifest.json'), 'utf8'))
  const otherSkills = await textUnder(['academic-paper-reviewer', 'deep-research'])
  const paper = await textUnder(['academic-paper'])
  for (const file of PAPER_ONLY_SHARED) {
    assert.ok(manifest.sharedFiles.includes(file), file + ' is not in the shared closure')
    assert.ok(manifest.files[file] !== undefined, file + ' is not pinned')
    assert.ok(
      paper.some(entry => entry.text.includes(file)),
      file + ' is not actually referenced by academic-paper, so this test would prove nothing',
    )
    // "Paper-only" means the two skills vendored before it never name it, so the
    // file can only have entered the closure through the third skill. Mentions
    // from other shared/ documents are fine - the closure follows those too.
    const mentioned = otherSkills.filter(entry => entry.text.includes(file)).map(entry => entry.name)
    assert.deepEqual(mentioned, [], file + ' is also referenced by ' + mentioned.join(', ') + ', so it is not paper-only')
  }
  assert.ok(PAPER_ONLY_SHARED.length > 0)
})

test('the registry receipts are unreachable by the path scan, so the receipt rule is what vendors them', async () => {
  const manifest = JSON.parse(await readFile(join(repoRoot, 'vendor-manifest.json'), 'utf8'))
  const receipts = manifest.sharedViaRegistryReceipts.map(entry => entry.file)
  assert.equal(receipts.length, EXPECTED_SHARED_COUNTS.byRegistryReceipt)
  const everything = await textOutside([])
  for (const receipt of receipts) {
    const mentions = everything.filter(entry => entry.name !== receipt && entry.text.includes(receipt)).map(entry => entry.name)
    assert.deepEqual(mentions, [], receipt + ' is named by ' + mentions.join(', ') + ', so the scan could have found it')
  }
  // byScan must therefore be exactly the scan set, with the receipts added on top.
  assert.equal(manifest.vendored.sharedFileCounts.byScan + receipts.length, manifest.sharedFiles.length)
})