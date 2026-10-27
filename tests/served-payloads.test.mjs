/**
 * What ships, and what is served (t30, items 2 and 4).
 *
 * sr-screener made the package's payload extension-agnostic: 89 of the 279 vendored
 * files are not markdown (79 .json, 6 .py, 2 .js, 1 .tex, 1 .yaml). Pinning a list
 * of six script names would prove that those six exist and nothing else, so the
 * assertions here are shaped as a class:
 *
 * - the manifest and the working tree are a bijection: every pinned file is on disk
 *   and every file on disk is pinned, so a dropped file and a stray file both fail;
 * - the payload COUNT is asserted, not the names, so a file that disappears from
 *   both the tree and the manifest still fails the count;
 * - each payload file's bytes hash to the blob the index holds, computed by git
 *   itself with --no-filters: that is the "not normalised by any tooling" proof, and
 *   it is why a CRLF worktree copy cannot pass;
 * - the four served payloads all carry policy A: block + body (+ a notice where the tree
 *   names unvendored areas). The rule is attached to every skill rather than selected by
 *   a detector, so the reviewer and deep-research gain the block and the two skills that
 *   already had it do not move; the table survives as documentation of why each skill was
 *   classified as it was.
 *
 * @module dsh-academic-review/tests/served-payloads
 */

import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readdir, readFile } from 'node:fs/promises'
import { join, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import { Context } from '@deepseek-ai/cordis'
import { SkillRegistry } from '@deepseek-ai/dsh-skill'
import {
  PORT_NOTICE_BEGIN,
  PORT_NOTICE_END,
  defaultVendorBasePath,
  parseSkillDocument,
  registerReviewSkillProvider,
} from '../lib/skills.js'
import {
  WRITE_POLICY_BEGIN,
  WRITE_POLICY_END,
  fileProducingEntry,
  renderWritePolicyBlock,
  writePolicyMetadataOf,
} from '../lib/write-policy.js'

const repoRoot = fileURLToPath(new URL('..', import.meta.url))
const vendorRoot = defaultVendorBasePath()
const vendorDir = join(repoRoot, 'vendor')

/** The four served skills, in discovery order. */
const SERVED_SKILLS = ['academic-paper', 'academic-paper-reviewer', 'deep-research', 'sr-screener']

/** The two skills policy A travels with, and why each one qualifies. */
const PRODUCERS = { 'academic-paper': 'prose-drafting', 'sr-screener': 'bundled-script' }

/**
 * Measured at 3f16ec3 ("attach policy A to every served skill") with the provider's own
 * output, not typed in from a report: the block is 684 bytes and these are the served
 * totals. They are pinned so that a body reflow, a notice change or a block edit has to
 * be a deliberate re-pin. The relationships below also assert each total against its
 * parts, so a failure says which part moved.
 */
const SERVED_BYTES = { 'academic-paper': 65113, 'academic-paper-reviewer': 47984, 'deep-research': 52316, 'sr-screener': 33212 }
const BLOCK_BYTES = 684

/**
 * The totals as they stood while the rule was SELECTED (two producers only), and the
 * change each skill was allowed to make when it became ATTACHED (all four). The delta is
 * asserted separately from the total because a total can be right for the wrong reason:
 * a double attachment shows as +1368, a missing block on a producer shows as -684, and
 * both would leave 'block + body + notice' arithmetically satisfied if the block were
 * counted twice on one side.
 */
const PREVIOUS_PIN = { 'academic-paper': 65113, 'academic-paper-reviewer': 47300, 'deep-research': 51632, 'sr-screener': 33212 }
const DELTA = { 'academic-paper': 0, 'academic-paper-reviewer': BLOCK_BYTES, 'deep-research': BLOCK_BYTES, 'sr-screener': 0 }

/** The vendored file count and how many of them are payload rather than markdown. */
const VENDORED_FILES = 279
const PAYLOAD_FILES = 89
/** Per-skill split: markdown + payload = the manifest's fileCount. */
const MARKDOWN_PER_SKILL = { 'academic-paper': 62, 'academic-paper-reviewer': 28, 'deep-research': 53, 'sr-screener': 15 }
const PAYLOAD_PER_SKILL = { 'academic-paper': 1, 'academic-paper-reviewer': 0, 'deep-research': 0, 'sr-screener': 10 }

/** Extensions whose bytes are text, so a CR would be a conversion artefact. */
const TEXT_EXTENSIONS = new Set(['.json', '.py', '.js', '.mjs', '.cjs', '.tpl', '.yaml', '.yml', '.tex', '.txt'])

/** Every file under a directory, as vendor-relative POSIX paths. */
async function walkVendor(dir, prefix = '') {
  const out = []
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const relativePath = prefix === '' ? entry.name : prefix + '/' + entry.name
    if (entry.isDirectory()) out.push(...await walkVendor(join(dir, entry.name), relativePath))
    else out.push(relativePath)
  }
  return out
}

/** UTF-8 byte length, the unit the release gate reports. */
function byteLength(text) {
  return Buffer.byteLength(text, 'utf8')
}

/** git, in the repo, for the plumbing calls this file needs. */
function git(args, options = {}) {
  return execFileSync('git', args, { cwd: repoRoot, maxBuffer: 1 << 28, encoding: 'utf8', ...options })
}

test('the payload is a class, not a list: count, tree/manifest bijection, bytes, line endings', async () => {
  const manifest = JSON.parse(await readFile(join(repoRoot, 'vendor-manifest.json'), 'utf8'))
  const pinned = Object.keys(manifest.files).sort()
  const onDisk = (await walkVendor(vendorDir)).sort()

  // Bijection: a file dropped from the tree, or one that appeared without a pin,
  // both fail here. This is what a hardcoded name list cannot give.
  assert.deepEqual(onDisk, pinned, 'the vendored tree and the manifest must list the same files')
  assert.equal(onDisk.length, VENDORED_FILES, 'the vendored file count moved')

  const payload = onDisk.filter(name => name.endsWith('.md') === false)
  const byExtension = {}
  for (const name of payload) {
    const extension = name.slice(name.lastIndexOf('.'))
    byExtension[extension] = (byExtension[extension] ?? 0) + 1
  }
  assert.equal(payload.length, PAYLOAD_FILES, 'the non-markdown payload count moved')
  assert.deepEqual(byExtension, { '.json': 79, '.py': 6, '.js': 2, '.tex': 1, '.yaml': 1 },
    'the payload is what the manifest says it is, extension by extension')

  // Per skill: markdown + payload = the manifest's own fileCount, so a skill that
  // lost a payload file fails even if the grand total happens to stay put.
  for (const skill of SERVED_SKILLS) {
    const mine = onDisk.filter(name => name.startsWith(skill + '/'))
    const markdown = mine.filter(name => name.endsWith('.md')).length
    const skillPayload = mine.length - markdown
    assert.equal(markdown, MARKDOWN_PER_SKILL[skill], skill + ' markdown count moved')
    assert.equal(skillPayload, PAYLOAD_PER_SKILL[skill], skill + ' payload count moved')
    const declared = manifest.skills.find(entry => entry.name === skill)
    assert.ok(declared !== undefined, skill + ' must be in the manifest')
    assert.equal(declared.fileCount, mine.length, skill + ' fileCount must match the tree')
  }

  let crFree = 0
  for (const name of payload) {
    const bytes = await readFile(join(vendorDir, name))
    assert.ok(bytes.length > 0, name + ' ships empty')
    assert.equal(createHash('sha256').update(bytes).digest('hex'), manifest.files[name], 'digest drift in ' + name)
    if (TEXT_EXTENSIONS.has(name.slice(name.lastIndexOf('.')))) {
      assert.equal(bytes.includes(0x0d), false, name + ' carries CR, so something text-converted it')
      crFree += 1
    }
  }
  console.log('# ' + String(VENDORED_FILES) + ' vendored files (' + String(VENDORED_FILES - PAYLOAD_FILES) + ' markdown + '
    + String(PAYLOAD_FILES) + ' payload: ' + Object.entries(byExtension).map(([ext, count]) => String(count) + ' ' + ext).join(', ')
    + '), every payload file hashed against its pin, ' + String(crFree) + ' text payloads CR-free')
})

test('every payload file is the object the index holds: git hashes the bytes with no filter', async () => {
  const onDisk = await walkVendor(vendorDir)
  const payload = onDisk.filter(name => name.endsWith('.md') === false).sort()

  // The blob each path is committed as...
  const staged = new Map()
  for (const line of git(['ls-files', '-s', '--', 'vendor']).split('\n')) {
    const match = /^\d+ ([0-9a-f]{40}) \d\t(.+)$/u.exec(line.trim())
    if (match !== null) staged.set(match[2].replace(/^vendor\//u, ''), match[1])
  }
  // ...and the hash git computes for the bytes on disk, with every filter bypassed.
  // Equality means the file IS the object: a CRLF worktree copy would hash
  // differently, which is exactly the failure this round was about.
  const hashed = git(['hash-object', '--no-filters', '--stdin-paths'], {
    input: payload.map(name => join('vendor', name)).join('\n') + '\n',
  }).split('\n').filter(Boolean)

  assert.equal(hashed.length, payload.length, 'git must hash every payload file')
  const mismatched = []
  payload.forEach((name, index) => {
    const blob = staged.get(name)
    if (blob === undefined) mismatched.push(name + ' is not staged')
    else if (blob !== hashed[index]) mismatched.push(name + ' hashes to ' + hashed[index] + ' but is committed as ' + blob)
  })
  assert.deepEqual(mismatched, [], mismatched.join('; '))

  // git's own view of the line-ending policy for the whole payload, not just a sample.
  const attributes = git(['check-attr', 'text', '--', ...payload.map(name => join('vendor', name))])
  const converted = attributes.split('\n').filter(line => line.trim() !== '' && line.endsWith('text: unset') === false)
  assert.deepEqual(converted, [], 'these payload files are subject to a text filter: ' + converted.join('; '))

  console.log('# ' + String(payload.length) + ' payload files: on-disk bytes hash to the committed blob under --no-filters, '
    + 'and git reports text:unset for every one')
})

test('all four served payloads carry the rule: block + body (+ notice), and the table is documentation', async () => {
  const ctx = new Context()
  const registry = new SkillRegistry(ctx)
  registerReviewSkillProvider(ctx, { providerName: 'academic-review', vendorBasePath: vendorRoot })

  const served = new Map()
  const bodies = new Map()
  for (const skill of SERVED_SKILLS) {
    const definition = await registry.get(skill, { cwd: repoRoot })
    assert.ok(definition !== undefined, skill + ' must be served')
    served.set(skill, definition)
    bodies.set(skill, parseSkillDocument(await readFile(join(vendorDir, skill, 'SKILL.md'), 'utf8')).body)
  }

  // THE RULE IS ATTACHED, NOT SELECTED. renderWritePolicyBlock() takes no argument and
  // does not consult the table even when a name is offered: a skill the table has never
  // heard of gets the same 684 bytes. Why: qa-gate built adversarial skills against the
  // old detector and produced three guaranteed false negatives - a skill that writes
  // through shell commands it does not ship, one that writes with inline python -c, and
  // one whose prose says 'generate the deliverable' (generate is not a writing verb) -
  // and its structural point decided the design: a both-directions table test cannot see
  // a SHARED blind spot, because when the rule misses a skill the rule and the table
  // agree on 'no'. So the block is unconditional and the detector survives as
  // documentation of why each skill was ever classified the way it was.
  const block = renderWritePolicyBlock()
  assert.equal(renderWritePolicyBlock.length, 0, 'the renderer must take no skill name: the rule is attached, not selected')
  assert.equal(byteLength(block), BLOCK_BYTES, 'the prepended block moved')
  assert.equal(renderWritePolicyBlock('no-such-skill'), block, 'the block must not depend on the skill name')
  assert.equal(renderWritePolicyBlock('academic-paper-reviewer'), block, 'not even the reviewer gets a different rule')

  for (const skill of SERVED_SKILLS) {
    const definition = served.get(skill)
    const body = bodies.get(skill)
    assert.equal(definition.content.startsWith(block), true, skill + ': the block must be the first thing read')
    assert.equal(definition.content.includes(block + body), true, skill + ': the block must be followed immediately by the body')
    // Exactly one block. A second attachment would still 'start with the block' and
    // would show in the delta below as +1368 instead of +684.
    assert.equal(definition.content.split(WRITE_POLICY_BEGIN).length - 1, 1, skill + ': exactly one write-policy block')
    const notice = definition.content.slice(block.length + body.length)
    if (notice.trim() === '') {
      assert.equal(notice, '', skill + ': a tree that earns no notice must contribute no bytes at all')
    } else {
      assert.equal(notice.trimStart().startsWith(PORT_NOTICE_BEGIN), true, skill + ': whatever follows the body must be an append notice')
      assert.equal(notice.trimEnd().endsWith(PORT_NOTICE_END), true, skill + ': the notice must end the payload')
    }
    assert.equal(byteLength(definition.content), BLOCK_BYTES + byteLength(body) + byteLength(notice),
      skill + ': the served payload must be block + body + notice')
    assert.equal(byteLength(definition.content), SERVED_BYTES[skill], skill + ': the served payload moved')
    // The DELTA is the component check: a total can be right while a component is
    // wrong, and the two skills that gained the rule this round must gain exactly one
    // block while the two that already had it must not move at all.
    assert.equal(SERVED_BYTES[skill] - PREVIOUS_PIN[skill], DELTA[skill],
      skill + ': the change since the previous pin must be exactly ' + String(DELTA[skill]) + ' byte(s)')

    // The policy is advertised for every skill now, because it is prepended to every
    // skill; the enforcement flag still tells the truth, and the basis - the instrument
    // that put the skill in the table - is present only where the table names one.
    const definitionMetadata = definition.metadata
    const declared = writePolicyMetadataOf(skill)
    assert.equal(definitionMetadata.writePolicy, 'new-paths-only', skill + ': every served skill carries policy A')
    assert.equal(definitionMetadata.writePolicyEnforced, false, skill + ': the rule is an instruction, not an interlock')
    assert.equal(definitionMetadata.writePolicyEnforced, declared.writePolicyEnforced, skill + ': the enforcement flag must mirror the table output')
    const inTable = PRODUCERS[skill] !== undefined
    assert.equal(definitionMetadata.writePolicyBasis, inTable ? declared.writePolicyBasis : undefined,
      skill + (inTable ? ': the served metadata must mirror the basis' : ': a skill the table does not name has no basis to disclose'))

    console.log('# payload ' + skill.padEnd(24) + ' ' + String(byteLength(definition.content)).padStart(6)
      + ' = body ' + String(byteLength(body)).padStart(6)
      + ' + block ' + String(byteLength(block)).padStart(3)
      + ' + notice ' + String(byteLength(notice)).padStart(3)
      + '   delta ' + String(DELTA[skill]).padStart(4)
      + (inTable ? '  [' + PRODUCERS[skill] + ']' : ''))
  }

  // The notice is a property of the tree, not of the skill: the two trees whose own
  // markdown names paths this port does not vendor carry one, the other two carry none.
  for (const skill of ['academic-paper-reviewer', 'sr-screener']) {
    const definition = served.get(skill)
    // Slice by CHARACTER offset (block.length + body.length); byteLength is for the
    // arithmetic only, and the two differ the moment a body holds a non-ASCII character.
    assert.equal(definition.content.slice(block.length + bodies.get(skill).length), '',
      skill + ' earns no port notice: every path its own markdown names is vendored')
  }
  for (const skill of ['academic-paper', 'deep-research']) {
    const definition = served.get(skill)
    const notice = definition.content.slice(block.length + bodies.get(skill).length)
    assert.notEqual(notice.trim(), '', skill + ' must still carry the notice for the areas this port does not vendor')
  }

  // The table's two entries still describe two different measurements with two
  // different reasons. That is now documentation rather than a condition - the rule's
  // presence no longer depends on it - so a third skill arriving with a new reason is a
  // table edit and nothing else.
  const bases = Object.values(PRODUCERS)
  assert.equal(new Set(bases).size, 2, 'the table must keep two different reasons on record')
  const reasons = Object.keys(PRODUCERS).map(skill => fileProducingEntry(skill).reason)
  assert.equal(new Set(reasons).size, 2, 'each table entry needs its own reason, not a shared one')
  for (const reason of reasons) {
    assert.equal(typeof reason, 'string', 'a table entry must carry a reason')
    assert.equal(reason.trim().includes(' '), true, 'the reason must be a sentence, not a label')
  }
  for (const skill of Object.keys(PRODUCERS)) {
    assert.equal(fileProducingEntry(skill).basis, PRODUCERS[skill], skill + ' must still qualify on ' + PRODUCERS[skill])
  }
  console.log('# attached rule: ' + String(BLOCK_BYTES) + ' bytes on all four skills; table reasons differ '
    + '(academic-paper -> ' + PRODUCERS['academic-paper'] + ', sr-screener -> ' + PRODUCERS['sr-screener'] + ') and are documentation now')
  console.log('# reviewer = block + body, deep-research = block + body + notice, academic-paper = block + body + notice, '
    + 'sr-screener = block + body (no notice on this tree)')
})
