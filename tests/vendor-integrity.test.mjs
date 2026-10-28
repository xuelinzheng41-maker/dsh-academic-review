/**
 * Vendored-tree integrity tests: every vendored file matches the SHA-256
 * recorded at vendoring time, the per-skill counts hold, the shared/ closure in
 * the manifest is the one on disk, and no plugin code writes into vendor/.
 */
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { readFile, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import { computeRegistryReceipts, computeSharedClosure, criterionIds } from '../scripts/vendor-upstream.mjs'

const repoRoot = fileURLToPath(new URL('..', import.meta.url))

const EXPECTED_SKILLS = [
  'academic-paper-reviewer',
  'deep-research',
  'academic-paper',
  'sr-screener',
  'academic-pipeline',
]
const EXPECTED_SKILL_FILE_COUNTS = {
  'academic-paper-reviewer': 28,
  'deep-research': 53,
  'academic-paper': 63,
  'sr-screener': 25,
  'academic-pipeline': 30,
}
// The closure is derived, but its SIZE is pinned here on purpose: a rule change that
// quietly stops following part of the tree has to be a deliberate edit.
//
// byRegistryReceipt is 0 as of the academic-pipeline round, and that is a change of FACT
// rather than a relaxation: shared/contracts/README.md (new with that tree) names
// shared/review_criteria_sources/, so the path scan now reaches both receipts and the
// receipt rule has nothing left to add. The rule is not dead - the test below drives it
// with that one mention blanked and requires it to supply exactly those two files - but
// while the mention exists it cannot be what vendors them, and a count claiming otherwise
// would be describing an older tree.
const EXPECTED_SHARED_COUNTS = { total: 143, byScan: 143, byRegistryReceipt: 0 }
// Counted from the upstream git objects: 199 skill files + 143 shared files. Was 279
// (169 + 110) before academic-pipeline was vendored; derived from the two counts above so
// that updating one without the other is caught here.
const EXPECTED_TOTAL_FILES = Object.values(EXPECTED_SKILL_FILE_COUNTS)
  .reduce((sum, count) => sum + count, 0) + EXPECTED_SHARED_COUNTS.total

test('vendor-manifest.json pins the upstream identity and the vendored skills', async () => {
  const manifest = JSON.parse(await readFile(join(repoRoot, 'vendor-manifest.json'), 'utf8'))
  assert.equal(manifest.schemaVersion, 2)
  assert.equal(manifest.upstream.skillVersion, '1.11.1')
  assert.equal(manifest.upstream.commit, '1ec249df98728682dfbbdfb940a658338bfd6f80')
  assert.equal(manifest.upstream.license, 'CC BY-NC 4.0')
  assert.deepEqual(manifest.vendored.skills, EXPECTED_SKILLS)
  assert.deepEqual(manifest.vendored.skillFileCounts, EXPECTED_SKILL_FILE_COUNTS)
  assert.equal(manifest.vendored.skillFileCount,
    Object.values(EXPECTED_SKILL_FILE_COUNTS).reduce((sum, count) => sum + count, 0))
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
  // Every shared file is vendored by exactly one rule, and the manifest says which. The
  // formula is the invariant; the split is a fact about the current tree. It used to be
  // 108 + 2 with the receipts unreachable by the scan; now the scan reaches them, so it is
  // 143 + 0 and the receipts are recorded as receipt CANDIDATES rather than as an addition.
  // Both halves are asserted: the sum must balance, and no rule may claim more receipts
  // than there are.
  assert.equal(manifest.sharedCarriedOver, undefined, 'no catch-all carry-over field')
  const counts = manifest.vendored.sharedFileCounts
  assert.equal(counts.byScan + counts.byRegistryReceipt, manifest.sharedFiles.length)
  assert.ok(counts.byRegistryReceipt <= manifest.sharedViaRegistryReceipts.length,
    'a rule may not claim more receipts than exist')
  for (const receipt of manifest.sharedViaRegistryReceipts) {
    assert.ok(manifest.sharedFiles.includes(receipt.file), 'a cited receipt must still be vendored: ' + receipt.file)
  }
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

/**
 * A read-only index over a vendored tree, shaped like the upstream index the vendoring
 * pipeline hands to computeSharedClosure: a path that leaves the tree (any dot-dot
 * segment) is invisible, because an index over one tree cannot see outside it.
 */
function treeIndex(root) {
  const normal = (path) => path.replace(/\/{2,}/gu, '/')
  return {
    readText: (path) => readFileSync(join(root, normal(path)), 'utf8'),
    typeOf: (path) => {
      if (path.includes('..') || path.includes('./')) return 'missing'
      try {
        return statSync(join(root, normal(path))).isDirectory() ? 'dir' : 'file'
      } catch {
        return 'missing'
      }
    },
    filesUnder: (path) => {
      if (path.includes('..')) return []
      const out = []
      const walk = (relativePath) => {
        for (const entry of readdirSync(join(root, relativePath), { withFileTypes: true })) {
          const next = relativePath + '/' + entry.name
          if (entry.isDirectory()) walk(next)
          else out.push(next)
        }
      }
      try {
        walk(normal(path))
      } catch {
        return []
      }
      return out.sort()
    },
  }
}

/**
 * The shared/ scope is decided by two rules. This test used to assert that the receipts
 * were UNREACHABLE by the path scan - that nothing named them, so the receipt rule was
 * the only thing that could vendor them. That premise stopped being true when the
 * academic-pipeline tree arrived: shared/contracts/README.md names
 * shared/review_criteria_sources/, the scan reaches both receipts, and byRegistryReceipt
 * fell to 0. Deleting the test would have been the easy edit and the wrong one: the
 * receipt rule is still the only thing that vendors a provenance receipt no path names,
 * and if it broke, nothing would notice until a re-vendor shipped a registry whose
 * criteria claim provenance we do not ship.
 *
 * So it asserts the CURRENT state and then drives the rule with the one mention blanked -
 * the counterfactual ci-engineer built by hand - requiring the receipt rule to supply
 * exactly the two files the scan loses, and the two counts to still sum to the total.
 */
test('the scan reaches every shared file today, and the receipt rule still supplies what it cannot see', async () => {
  const manifest = JSON.parse(await readFile(join(repoRoot, 'vendor-manifest.json'), 'utf8'))
  const index = treeIndex(join(repoRoot, 'vendor'))
  const skillFiles = Object.keys(manifest.files)
    .filter(file => manifest.vendored.skills.some(skill => file.startsWith(skill + '/')))
    .sort()

  // CURRENT STATE: the scan alone reproduces the recorded closure, file for file.
  const closure = computeSharedClosure({ skillFiles, readText: index.readText, typeOf: index.typeOf, filesUnder: index.filesUnder })
  assert.deepEqual(closure.missing, [], 'every reference the vendored markdown makes must resolve')
  assert.deepEqual(closure.sharedFiles, manifest.sharedFiles,
    'the path scan must reproduce manifest.sharedFiles exactly while it reaches every file')
  assert.equal(manifest.vendored.sharedFileCounts.byScan, manifest.sharedFiles.length,
    'byScan must account for every shared file while the scan reaches them all')
  assert.equal(manifest.vendored.sharedFileCounts.byRegistryReceipt, 0,
    'the receipt rule adds nothing while the scan sees the receipts; a non-zero count means the two'
    + ' rules double-counted, and the formula would still balance')

  // Why the scan wins: exactly one vendored file names the receipts directory. Recorded
  // here so that if that mention disappears, this test is the thing that says so.
  const namers = Object.keys(manifest.files).filter(file =>
    index.readText(file).includes('shared/review_criteria_sources/'))
  assert.deepEqual(namers, ['shared/contracts/README.md'],
    'the mention that makes the receipts reachable must be named here')

  // COUNTERFACTUAL: blank that one mention. The scan loses the receipts; the rule must
  // supply them, and nothing else may change.
  const anchor = 'shared/review_criteria_sources/'
  const blanked = (file) => file === 'shared/contracts/README.md'
    ? index.readText(file).split(anchor).join('')
    : index.readText(file)
  assert.equal(blanked('shared/contracts/README.md').includes(anchor), false,
    'the counterfactual must actually remove the mention, not merely be intended to')
  const blind = computeSharedClosure({ skillFiles, readText: blanked, typeOf: index.typeOf, filesUnder: index.filesUnder })
  assert.equal(blind.sharedFiles.length, closure.sharedFiles.length - 2,
    'blanking the mention must lose exactly the two receipts, so the counterfactual measures the rule'
    + ' and not the edit')

  const receipts = computeRegistryReceipts({
    receiptFiles: index.filesUnder('shared/review_criteria_sources'),
    readText: index.readText,
  })
  const scanned = new Set(blind.sharedFiles)
  const viaReceipts = receipts.included.map(entry => entry.file).filter(file => !scanned.has(file)).sort()
  assert.deepEqual(viaReceipts, manifest.sharedViaRegistryReceipts.map(entry => entry.file).sort(),
    'the receipt rule must supply exactly the files the scan cannot see')
  assert.deepEqual(manifest.sharedFiles.filter(file => !blind.sharedFiles.includes(file)), viaReceipts,
    'the files the scan lost and the files the rule supplied must be the same set')
  assert.equal(blind.sharedFiles.length + viaReceipts.length, manifest.sharedFiles.length,
    'scan + receipt rule must still reconstruct the recorded closure')

  console.log('# shared/ rules: scan alone reproduces ' + String(closure.sharedFiles.length)
    + ' files (byRegistryReceipt 0); with its one mention blanked the scan loses '
    + String(viaReceipts.length) + ' and the receipt rule supplies exactly those: '
    + String(blind.sharedFiles.length) + ' + ' + String(viaReceipts.length) + ' = ' + String(manifest.sharedFiles.length))
})

// --- extension-agnostic vendoring -------------------------------------------
//
// sr-screener is the first vendored skill that ships executable payload: six
// Python scripts, two workflow templates in JavaScript and two JSON documents.
// Nothing in the pipeline may be markdown-only, so every non-markdown file in the
// package is checked here against its pin, and its line endings are checked where
// the format is text at all.

/** Extensions whose bytes are text, so a CR would be a conversion artefact. */
const TEXT_EXTENSIONS = new Set(['.json', '.py', '.js', '.tpl', '.yaml', '.yml', '.tex', '.txt'])

test('the vendor step is extension-agnostic: every payload file is pinned and converted by nothing', async () => {
  const manifest = JSON.parse(await readFile(join(repoRoot, 'vendor-manifest.json'), 'utf8'))
  const names = Object.keys(manifest.files)
  const payload = names.filter(name => !name.endsWith('.md'))
  // The floor used to be 'at least 89' because four trees held four different amounts of
  // payload and the only point was that markdown was not the only thing shipped. With five
  // trees a floor that low would pass while a whole skill's payload vanished, so the
  // expectation is per tree and exact. academic-pipeline contributes one file (.gitkeep).
  const PAYLOAD_PER_TREE = {
    'academic-paper': 1,
    'academic-paper-reviewer': 0,
    'academic-pipeline': 1,
    'deep-research': 0,
    'sr-screener': 10,
    shared: 108,
  }
  for (const [tree, expected] of Object.entries(PAYLOAD_PER_TREE)) {
    const held = payload.filter(name => tree === 'shared' ? name.startsWith('shared/') : name.startsWith(tree + '/'))
    assert.equal(held.length, expected,
      'the ' + tree + ' tree must ship ' + String(expected) + ' payload file(s), saw ' + String(held.length))
  }
  assert.equal(payload.length, Object.values(PAYLOAD_PER_TREE).reduce((sum, count) => sum + count, 0),
    'the payload count is the sum of the per-tree counts, so a file leaving one tree cannot hide in the total')
  // The fourth skill contributes exactly its ten payload files.
  const srPayload = payload.filter(name => name.startsWith('sr-screener/'))
  assert.deepEqual(srPayload.sort(), [
    'sr-screener/examples/example_config_dta.json',
    'sr-screener/scripts/build_outputs.py',
    'sr-screener/scripts/build_workflow.py',
    'sr-screener/scripts/merge_decisions.py',
    'sr-screener/scripts/prepare_fulltext.py',
    'sr-screener/scripts/prepare_records.py',
    'sr-screener/scripts/srlib.py',
    'sr-screener/templates/screening_config.template.json',
    'sr-screener/templates/workflows/ft_screening.template.js',
    'sr-screener/templates/workflows/ta_screening.template.js',
  ])
  // A placeholder is allowed to be empty, and nothing else is. academic-pipeline ships one
  // (.gitkeep, which exists to keep an otherwise-empty adapters/ directory in the tree), so
  // the rule is narrowed by NAME rather than dropped: an empty file that is not the known
  // placeholder still fails, and the placeholder is still pinned and hashed below.
  const PLACEHOLDERS = new Set(['academic-pipeline/references/adapters/.gitkeep'])
  for (const name of payload) {
    const bytes = await readFile(join(repoRoot, 'vendor', name))
    assert.equal(createHash('sha256').update(bytes).digest('hex'), manifest.files[name], 'digest drift in ' + name)
    if (PLACEHOLDERS.has(name)) {
      assert.equal(bytes.length, 0, name + ' is a placeholder, so emptiness is the whole of it')
      continue
    }
    assert.ok(bytes.length > 0, name + ' ships empty')
    if (TEXT_EXTENSIONS.has(name.slice(name.lastIndexOf('.')))) {
      assert.equal(bytes.includes(0x0d), false, name + ' carries CR, so something text-converted it')
    }
  }
})
