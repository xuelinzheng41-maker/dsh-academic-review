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
 * - the four served payloads keep their shape: the reviewer is its vendored body
 *   exactly, deep-research is body + notice, and both file-producing skills are
 *   block + body (+ notice), with two distinguishable reasons in metadata.
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
 * Measured on 1725f0f ("the block names the script shape"), not typed in from a
 * report: the block is 684 bytes and these are the served totals. They are pinned so
 * that a body reflow, a notice change or a block edit has to be a deliberate
 * re-pin. The relationships below also assert each total against its parts, so a
 * failure says which part moved.
 */
const SERVED_BYTES = { 'academic-paper': 65113, 'academic-paper-reviewer': 47300, 'deep-research': 51632, 'sr-screener': 33212 }
const BLOCK_BYTES = 684

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

test('the four served payloads: block, body, notice, and two distinguishable reasons', async () => {
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

  // The reviewer is the canary: nothing may be prepended or appended, so its served
  // payload is its vendored body and nothing else.
  const reviewer = served.get('academic-paper-reviewer')
  assert.equal(reviewer.content, bodies.get('academic-paper-reviewer'), 'the reviewer payload must be its vendored body exactly')
  assert.equal(reviewer.content.includes(WRITE_POLICY_BEGIN), false, 'the reviewer must carry no write-policy block')
  assert.equal(reviewer.metadata.writePolicy, undefined, 'the reviewer must not advertise a write policy')
  assert.equal(byteLength(reviewer.content), SERVED_BYTES['academic-paper-reviewer'])

  // deep-research carries its own append notice and no block.
  const research = served.get('deep-research')
  assert.equal(research.content.startsWith(bodies.get('deep-research')), true, 'deep-research is served verbatim after nothing')
  assert.equal(research.content.includes(WRITE_POLICY_BEGIN), false, 'deep-research must carry no write-policy block')
  assert.equal(byteLength(research.content), SERVED_BYTES['deep-research'])
  const researchNotice = research.content.slice(bodies.get('deep-research').length)
  assert.equal(researchNotice.trimStart().startsWith(PORT_NOTICE_BEGIN), true, 'deep-research keeps its append notice')
  assert.equal(researchNotice.trimEnd().endsWith(PORT_NOTICE_END), true, 'the notice must end the deep-research payload')
  assert.equal(research.metadata.writePolicy, undefined, 'deep-research must not advertise a write policy')

  // Both producers: the canonical block for that skill first, then the body, then
  // whatever notice the tree earns. The relationship is asserted as well as the
  // total, so a moved byte says which part moved.
  const blocks = new Map()
  for (const [skill, basis] of Object.entries(PRODUCERS)) {
    const definition = served.get(skill)
    const block = renderWritePolicyBlock(skill)
    blocks.set(skill, block)
    const body = bodies.get(skill)
    assert.equal(block.includes(WRITE_POLICY_BEGIN), true, skill + ': the block must open with its marker')
    assert.equal(block.includes(WRITE_POLICY_END), true, skill + ': the block must close with its marker')
    assert.equal(definition.content.startsWith(block), true, skill + ': the block must be the first thing read')
    assert.equal(definition.content.includes(block + body), true, skill + ': the block must be followed immediately by the body')
    assert.equal(definition.content.split(WRITE_POLICY_BEGIN).length, 2, skill + ': exactly one write-policy block')
    const notice = definition.content.slice(block.length + body.length)
    assert.equal(byteLength(block), BLOCK_BYTES, skill + ': the prepended block moved')
    assert.equal(byteLength(definition.content), BLOCK_BYTES + byteLength(body) + byteLength(notice),
      skill + ': the served payload must be block + body + notice')
    assert.equal(byteLength(definition.content), SERVED_BYTES[skill], skill + ': the served payload moved')

    // The two reasons are not the same reason wearing two hats: the table records a
    // distinct basis per skill, and the metadata mirrors the table.
    const entry = fileProducingEntry(skill)
    assert.ok(entry !== undefined, skill + ' must have a table entry')
    assert.equal(entry.basis, basis, skill + ' must qualify on ' + basis)
    // The metadata is the table's own output, not a second opinion about it.
    const declared = writePolicyMetadataOf(skill)
    assert.equal(definition.metadata.writePolicy, declared.writePolicy, skill + ': metadata must mirror the table')
    assert.equal(definition.metadata.writePolicyEnforced, declared.writePolicyEnforced,
      skill + ': the enforcement flag must mirror the table')
    // The instrument is disclosed to the model, not only recorded in this repository.
    // This assertion exists because the gap was real until 8f3b0aa: the metadata used
    // to say "a policy applies" without saying which measurement qualified the skill,
    // so a reader could not tell prose drafting from bundled scripts. Closing a gap
    // deserves an assertion; deleting the note would have been a silence.
    assert.equal(definition.metadata.writePolicyBasis, declared.writePolicyBasis,
      skill + ': the served metadata must mirror the basis in the table')
    assert.equal(definition.metadata.writePolicyBasis, entry.basis,
      skill + ': the served basis must be the instrument this skill actually qualified on')
    assert.equal(typeof entry.reason, 'string', skill + ': the table must carry a reason')
    assert.equal(entry.reason.trim().includes(' '), true, skill + ': the reason must be a sentence, not a label')
  }

  // The two qualifications are different reasons - drafting prose versus running
  // bundled scripts - and the table records which is which, with its own sentence.
  // The BLOCK, by contrast, is one rule for both carriers: it is the same 684 bytes
  // whichever reason qualified the skill, because a rule the model has to
  // reinterpret per skill is weaker than one rule stated once.
  const bases = Object.values(PRODUCERS)
  assert.equal(new Set(bases).size, 2, 'the two producers must qualify for two different reasons')
  const reasons = ['academic-paper', 'sr-screener'].map(skill => fileProducingEntry(skill).reason)
  assert.equal(new Set(reasons).size, 2, 'each entry needs its own reason, not a shared one')
  assert.equal(blocks.get('academic-paper'), blocks.get('sr-screener'),
    'the block is one rule for both carriers, so the two must be byte-identical')
  console.log('# qualifications differ in the table: academic-paper -> ' + fileProducingEntry('academic-paper').basis
    + ', sr-screener -> ' + fileProducingEntry('sr-screener').basis
    + '; the prepended block is the same ' + String(BLOCK_BYTES) + ' bytes for both')
  console.log('# the served metadata now discloses the instrument (writePolicyBasis): academic-paper -> '
    + String(served.get('academic-paper').metadata.writePolicyBasis) + ', sr-screener -> '
    + String(served.get('sr-screener').metadata.writePolicyBasis)
    + '; the reviewer and deep-research carry none of the three keys, and adding the key moved no payload byte')

  // ...and the two skills that produce nothing carry no trace of the policy, in any
  // of the three keys: a stray writePolicy on the reviewer would tell the model it is
  // held to a rule that was never prepended to its body.
  for (const skill of SERVED_SKILLS.filter(name => PRODUCERS[name] === undefined)) {
    const definition = served.get(skill)
    for (const key of ['writePolicy', 'writePolicyEnforced', 'writePolicyBasis']) {
      assert.equal(key in definition.metadata, false, skill + ' must not carry metadata.' + key)
    }
  }

  for (const skill of SERVED_SKILLS) {
    const definition = served.get(skill)
    const body = bodies.get(skill)
    const block = blocks.get(skill) ?? ''
    const notice = definition.content.slice(block.length + body.length)
    console.log('# payload ' + skill.padEnd(24) + ' ' + String(byteLength(definition.content)).padStart(6)
      + ' = body ' + String(byteLength(body)).padStart(6)
      + ' + block ' + String(byteLength(block)).padStart(3)
      + ' + notice ' + String(byteLength(notice)).padStart(3)
      + (PRODUCERS[skill] === undefined ? '' : '  [' + PRODUCERS[skill] + ']'))
  }
  console.log('# reviewer = body exactly, deep-research = body + notice, academic-paper = block + body + notice, '
    + 'sr-screener = block + body (no notice on this tree)')
})
