/**
 * Pins must describe the bytes the upstream REPOSITORY stores, not the bytes a
 * checkout happens to put on disk. core.autocrlf rewrites LF to CRLF during
 * checkout, so a worktree copy is no evidence of what upstream published - that
 * trap shipped once already and made every vendored file report digest drift on
 * Linux. These tests drive the vendoring helpers against a synthetic repository,
 * so they need no network and no real ARS checkout.
 */
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import {
  assertWorktreeClean,
  computeRegistryReceipts,
  computeSharedClosure,
  criterionIds,
  droppedPins,
  foldCrlf,
  repoBytes,
  resolveUpstreamCommit,
  sha256,
} from '../scripts/vendor-upstream.mjs'

let hasGit = true
try {
  execFileSync('git', ['--version'], { stdio: 'ignore' })
} catch {
  hasGit = false
}
const skip = hasGit ? false : 'git is not available'

const REL = 'academic-paper-reviewer/SKILL.md'
const LF_BODY = '# Demo skill\n\nLine one.\nLine two.\n'
const SKILL = 'academic-paper-reviewer'

function git(cwd, ...args) {
  return execFileSync('git', ['-C', cwd, ...args], { maxBuffer: 1 << 26 })
}

/** A tiny repository whose SKILL.md is committed as LF, exactly like upstream. */
async function makeUpstream(t, { autocrlf = 'false' } = {}) {
  const root = await mkdtemp(join(tmpdir(), 'vendor-source-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  await mkdir(join(root, SKILL), { recursive: true })
  await writeFile(join(root, REL), LF_BODY, 'utf8')
  git(root, 'init', '-q')
  git(root, 'config', 'user.name', 'vendor-source-test')
  git(root, 'config', 'user.email', 'vendor-source-test@example.invalid')
  git(root, 'config', 'core.autocrlf', 'false')
  git(root, 'add', '--', '.')
  git(root, 'commit', '-q', '-m', 'upstream')
  git(root, 'config', 'core.autocrlf', autocrlf)
  return root
}

const lfDigest = sha256(Buffer.from(LF_BODY, 'utf8'))
const crlfDigest = sha256(Buffer.from(LF_BODY.replace(/\n/g, '\r\n'), 'utf8'))

test('the byte source is the repository blob, not the CRLF-filtered worktree', { skip }, async (t) => {
  const root = await makeUpstream(t, { autocrlf: 'true' })
  // Re-checkout so the git filter materialises the file as CRLF on disk.
  await rm(join(root, REL), { force: true })
  git(root, 'checkout', '--', REL)
  const worktree = await readFile(join(root, REL))
  assert.ok(worktree.includes(0x0d), 'precondition: the checkout filter wrote CRLF into the worktree')
  assert.equal(sha256(worktree), crlfDigest, 'precondition: hashing the worktree would pin the CRLF digest')

  const bytes = repoBytes(root, REL, git(root, 'rev-parse', 'HEAD').toString('utf8').trim())
  assert.equal(bytes.includes(0x0d), false, 'the repository bytes carry no CR')
  assert.equal(sha256(bytes), lfDigest, 'the vendor step pins the digest upstream published')
  assert.equal(foldCrlf(worktree).equals(bytes), true, 'the worktree differs from the commit by line endings only')
  assert.deepEqual(assertWorktreeClean(root, REL, bytes), { filtered: true })
})

test('the pins do not depend on the checkout setting', { skip }, async (t) => {
  const pinned = []
  for (const autocrlf of ['true', 'false']) {
    const root = await makeUpstream(t, { autocrlf })
    await rm(join(root, REL), { force: true })
    git(root, 'checkout', '--', REL)
    const commit = git(root, 'rev-parse', 'HEAD').toString('utf8').trim()
    pinned.push({ autocrlf, digest: sha256(repoBytes(root, REL, commit)), worktree: await readFile(join(root, REL)) })
  }
  assert.equal(pinned[0].digest, pinned[1].digest, 'both checkouts pin the same digest')
  assert.equal(pinned[0].digest, lfDigest)
  assert.notEqual(sha256(pinned[0].worktree), pinned[1].digest, 'the filtered worktree is never what gets pinned')
})

test('an edited worktree is refused instead of pinned', { skip }, async (t) => {
  const root = await makeUpstream(t)
  const commit = git(root, 'rev-parse', 'HEAD').toString('utf8').trim()
  const bytes = repoBytes(root, REL, commit)
  await writeFile(join(root, REL), LF_BODY + 'unreleased local edit\n', 'utf8')
  assert.throws(() => assertWorktreeClean(root, REL, bytes), /differs from the commit beyond line endings/)
})

test('an upstream checkout that is not at the pinned commit is refused', { skip }, async (t) => {
  const root = await makeUpstream(t)
  assert.throws(() => resolveUpstreamCommit(root), /UPSTREAM\.commit|pinned commit/)
})

test('a plain directory is refused because repository bytes are unrecoverable', { skip }, async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'vendor-source-plain-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  assert.throws(() => resolveUpstreamCommit(root), /not a git checkout/)
})
// --- shared/ closure computation -------------------------------------------
//
// The closure is derived, never hand-maintained: whatever the vendored trees
// mention is followed, directories are expanded, siblings referenced from inside
// shared/ are followed one level further, and a reference that does not exist
// upstream is reported instead of being dropped on the floor.

function fakeRepo(tree) {
  const files = new Set(Object.keys(tree))
  const dirs = new Set()
  for (const file of files) {
    const parts = file.split('/')
    for (let i = 1; i < parts.length; i += 1) dirs.add(parts.slice(0, i).join('/'))
  }
  return {
    typeOf: path => (files.has(path) ? 'file' : dirs.has(path) ? 'dir' : 'missing'),
    filesUnder: dir => [...files].filter(file => file.startsWith(dir + '/')).sort(),
    readText: path => tree[path],
  }
}

function closureOf(tree, skillFiles = Object.keys(tree).filter(path => !path.startsWith('shared/'))) {
  return computeSharedClosure({ skillFiles, ...fakeRepo(tree) })
}

test('the closure follows a reference made by any vendored skill', () => {
  const closure = closureOf({
    'academic-paper-reviewer/SKILL.md': 'see shared/shared-by-both.md and shared/reviewer-only.md',
    'deep-research/SKILL.md': 'see shared/deep-research-only.md',
    'shared/shared-by-both.md': 'common',
    'shared/reviewer-only.md': 'only the reviewer needs this',
    'shared/deep-research-only.md': 'only deep-research needs this',
  })
  assert.deepEqual(closure.sharedFiles, [
    'shared/deep-research-only.md',
    'shared/reviewer-only.md',
    'shared/shared-by-both.md',
  ])
  assert.deepEqual(closure.missing, [])
})

test('the closure excludes a shared file nothing references', () => {
  const closure = closureOf({
    'deep-research/SKILL.md': 'see shared/used.md',
    'shared/used.md': 'used',
    'shared/orphan.md': 'nobody links to this',
  })
  assert.deepEqual(closure.sharedFiles, ['shared/used.md'])
  assert.equal(closure.sharedFiles.includes('shared/orphan.md'), false)
})

test('a directory reference expands to the files in it, and a deeper reference is followed', () => {
  const closure = closureOf({
    'deep-research/SKILL.md': 'governed by shared/contracts/re_review/ and shared/protocol.md',
    'shared/protocol.md': 'legacy machine forms live in shared/contracts/re_review/legacy/v1_0/verdict_record.schema.json',
    'shared/contracts/re_review/input_manifest.schema.json': '{}',
    'shared/contracts/re_review/verdict_record.schema.json': '{}',
    'shared/contracts/re_review/legacy/v1_0/verdict_record.schema.json': '{}',
    'shared/contracts/unrelated/other.schema.json': '{}',
  })
  assert.deepEqual(closure.sharedFiles, [
    'shared/contracts/re_review/input_manifest.schema.json',
    'shared/contracts/re_review/legacy/v1_0/verdict_record.schema.json',
    'shared/contracts/re_review/verdict_record.schema.json',
    'shared/protocol.md',
  ])
  // The directory is expanded recursively, so the nested legacy contract comes in
  // with it and needs no separate expansion.
  assert.deepEqual(closure.expandedDirs, [{ dir: 'shared/contracts/re_review', count: 3 }])
  assert.equal(closure.sharedFiles.includes('shared/contracts/unrelated/other.schema.json'), false)
})

test('a shared file naming a sibling pulls that sibling in, relative to shared/ too', () => {
  const closure = closureOf({
    'deep-research/SKILL.md': 'see shared/references/a.md',
    'shared/references/a.md': 'see b.md and review_criteria_sources/receipt.json',
    'shared/references/b.md': 'sibling',
    'shared/review_criteria_sources/receipt.json': '{}',
    'shared/references/not-mentioned.md': 'unreferenced sibling',
  })
  assert.deepEqual(closure.sharedFiles, [
    'shared/references/a.md',
    'shared/references/b.md',
    'shared/review_criteria_sources/receipt.json',
  ])
})

test('template placeholders and bare directory names are not references', () => {
  const closure = closureOf({
    'deep-research/SKILL.md': [
      'Load the template from shared/contracts/<domain>/<mode>.json.',
      'Everything under shared/ is licensed CC BY-NC 4.0.',
      'see shared/real.md',
    ].join('\n'),
    'shared/real.md': 'real',
    'shared/contracts/reviewer/full.json': '{}',
  })
  assert.deepEqual(closure.sharedFiles, ['shared/real.md'])
  assert.deepEqual(closure.missing, [])
})

test('a reference that does not exist upstream is reported, never silently dropped', () => {
  const closure = closureOf({
    'deep-research/SKILL.md': 'see shared/present.md and shared/typo-does-not-exist.md and shared/missing-dir/',
    'shared/present.md': 'present',
  })
  assert.deepEqual(closure.sharedFiles, ['shared/present.md'])
  assert.deepEqual(closure.missing, ['shared/missing-dir/', 'shared/typo-does-not-exist.md'])
})

test('the closure is idempotent and deterministic', () => {
  const tree = {
    'academic-paper-reviewer/SKILL.md': 'see shared/a.md',
    'deep-research/SKILL.md': 'see shared/b.md and shared/contracts/x/',
    'shared/a.md': 'see c.md',
    'shared/b.md': 'b',
    'shared/c.md': 'c',
    'shared/contracts/x/one.schema.json': '{}',
    'shared/contracts/x/two.schema.json': '{}',
  }
  const first = closureOf(tree)
  const second = closureOf(tree)
  assert.deepEqual(first, second)
  assert.deepEqual(first.sharedFiles, [...first.sharedFiles].sort(), 'sorted')
})
// --- provenance receipts the registry cites ---------------------------------
//
// A receipt is vendored only when the review-criteria registry cites at least one
// of its criterion ids. Nothing names these files by path, so the path scan cannot
// see the link; the rule parses the receipt instead of grepping it, and a receipt
// nobody cites is excluded instead of being carried along.

const REGISTRY = 'shared/review_criteria_registry.json'
const receiptPath = name => 'shared/review_criteria_sources/' + name

function receiptsFrom(tree, receiptFiles) {
  return computeRegistryReceipts({ receiptFiles, readText: path => tree[path], registryFile: REGISTRY })
}

test('a receipt is vendored for the criterion ids the registry cites, whatever its shape', () => {
  const tree = {
    [REGISTRY]: JSON.stringify({ criteria: [{ criterion_id: 'a.one' }, { criterion_id: 'b.two' }] }),
    [receiptPath('locators.json')]: JSON.stringify({
      criterion_locators: [{ criterion_id: 'a.one' }, { criterion_id: 'not.in.registry' }],
    }),
    [receiptPath('documents.json')]: JSON.stringify({
      documents: [{ criterion_id: 'b.two' }, { criterion_id: 'a.one' }],
    }),
    [receiptPath('orphan.json')]: JSON.stringify({ documents: [{ criterion_id: 'not.in.registry' }] }),
    [receiptPath('empty.json')]: JSON.stringify({ receipt_kind: 'git_repository_head_verification' }),
  }
  const result = receiptsFrom(tree, Object.keys(tree).filter(path => path.startsWith('shared/review_criteria_sources/')))

  assert.deepEqual(result.included, [
    { file: receiptPath('documents.json'), criterionIds: ['a.one', 'b.two'] },
    { file: receiptPath('locators.json'), criterionIds: ['a.one'] },
  ])
  assert.equal(result.registryCriterionIds, 2)

  // An uncited receipt is excluded with a reason that says why - it never rides along.
  assert.deepEqual(
    result.excluded.map(entry => entry.file),
    [receiptPath('empty.json'), receiptPath('orphan.json')],
  )
  assert.match(result.excluded[0].reason, /names no criterion_id/)
  assert.match(result.excluded[1].reason, /not\.in\.registry/)
})

test('the registry rule leaves every other unreferenced shared file out', () => {
  const tree = {
    [REGISTRY]: JSON.stringify({ criteria: [{ criterion_id: 'a.one' }] }),
    [receiptPath('cited.json')]: JSON.stringify({ documents: [{ criterion_id: 'a.one' }] }),
    'shared/references/orphan.md': 'an extra file nobody references',
    'shared/templates/orphan.md': 'another one',
  }
  const result = receiptsFrom(tree, [receiptPath('cited.json')])
  assert.deepEqual(result.included.map(entry => entry.file), [receiptPath('cited.json')])
  // The receipts rule only ever sees the receipt directory; it cannot pull in
  // arbitrary files elsewhere under shared/.
  assert.equal(result.included.some(entry => entry.file.includes('/references/')), false)
  assert.equal(result.included.some(entry => entry.file.includes('/templates/')), false)
})

test('dropping a previously pinned file is reported, never silent', () => {
  assert.deepEqual(
    droppedPins(['shared/review_criteria_sources/a.json', 'shared/references/b.md'], ['shared/references/b.md']),
    ['shared/review_criteria_sources/a.json'],
  )
  assert.deepEqual(droppedPins(['shared/references/b.md'], ['shared/references/b.md']), [])
  assert.deepEqual(droppedPins([], ['shared/references/b.md']), [])
})

test('criterion ids are collected at any depth and from either receipt shape', () => {
  assert.deepEqual([...criterionIds({ criterion_locators: [{ criterion_id: 'x' }] })], ['x'])
  assert.deepEqual([...criterionIds({ documents: [{ criterion_id: 'y' }, { nested: { criterion_id: 'z' } }] })], ['y', 'z'])
  assert.deepEqual([...criterionIds({ criterion_ids: ['not.a.scalar.field'] })], [])
})

test('the registry rule is idempotent and deterministic', () => {
  const tree = {
    [REGISTRY]: JSON.stringify({ criteria: [{ criterion_id: 'a.one' }, { criterion_id: 'b.two' }] }),
    [receiptPath('one.json')]: JSON.stringify({ documents: [{ criterion_id: 'b.two' }, { criterion_id: 'a.one' }] }),
  }
  const files = [receiptPath('one.json')]
  assert.deepEqual(receiptsFrom(tree, files), receiptsFrom(tree, files))
})
