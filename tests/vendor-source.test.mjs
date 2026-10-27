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
