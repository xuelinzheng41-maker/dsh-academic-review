/**
 * What ships, and what is served (t30, items 2 and 4).
 *
 * sr-screener made the package's payload extension-agnostic: 120 of the 342 vendored
 * files are not markdown (109 .json, 6 .py, 2 .js, 1 .tex, 1 .yaml, 1 .gitkeep). Pinning a list
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
 * - the five served payloads all carry policy A: block + body (+ a notice where the tree
 *   names unvendored areas). The rule is attached to every skill rather than selected by
 *   a detector, so the reviewer and deep-research gain the block and the two skills that
 *   already had it do not move; the table survives as documentation of why each skill was
 *   classified as it was.
 * - a notice that DISAPPEARS is asserted, not deleted. academic-paper and deep-research
 *   each carried one until the academic-pipeline tree was vendored, which resolves the
 *   paths their markdown names; both totals therefore SHRANK, and the shrink is recorded
 *   with its cause so that a returned notice reads as a regression and not as a re-pin.
 *
 * @module dsh-academic-skills/tests/served-payloads
 */

import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readdir, readFile } from 'node:fs/promises'
import { join, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import { Context } from '@deepseek-ai/cordis'
import { EXPECTED_SERVED_BYTES, EXPECTED_SERVED_BYTES_TOTAL, byteLengthOf } from './helpers.mjs'
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

/** The five served skills, in discovery order. */
const SERVED_SKILLS = [
  'academic-paper',
  'academic-paper-reviewer',
  'academic-pipeline',
  'deep-research',
  'sr-screener',
]

/** The skills the table names, and the instrument that put each one there. */
const PRODUCERS = {
  'academic-paper': 'prose-drafting',
  'academic-pipeline': 'orchestration-closure',
  'sr-screener': 'bundled-script',
}

/**
 * Measured from the provider's own output, not typed in from a report: the block is 684
 * bytes and these are the served totals. They are pinned so that a body reflow, a notice
 * change or a block edit has to be a deliberate re-pin. The relationships below also
 * assert each total against its parts, so a failure says which part moved.
 *
 * Re-pinned at 88356e3 (the academic-pipeline round). Only academic-pipeline has a notice
 * (853 bytes, four references its tree names that this port does not vendor).
 */
const SERVED_BYTES = EXPECTED_SERVED_BYTES
const BLOCK_BYTES = 684

/**
 * The served totals at the v0.4.1 freeze, and what moved since. A delta is asserted
 * separately from the total because a total can be right for the wrong reason: a body
 * reflow and a lost notice can cancel out, and 'block + body + notice' stays arithmetically
 * satisfied either way.
 *
 * The two NEGATIVE deltas are improvements and are recorded as such. A notice is only
 * emitted for a reference the served tree makes to a path this port does not vendor, so a
 * notice that goes away means the path now resolves - academic-paper and deep-research each
 * named four or five areas that academic-pipeline's own files now supply. Asserting the
 * shrink against the former notice size (below) is what stops 'the total went down' from
 * reading as a regression, and stops 'the total came back up' from passing silently.
 */
const V041_TOTALS = {
  'academic-paper': 65113,
  'academic-paper-reviewer': 47984,
  'deep-research': 52316,
  'sr-screener': 33212,
}
const CHANGE_SINCE_V041 = {
  'academic-paper': -572,
  'academic-paper-reviewer': 0,
  'academic-pipeline': 59934,
  'deep-research': -563,
  'sr-screener': 0,
}

/** Notice bytes that left with the changed trees: academic-paper, deep-research. */
const NOTICE_LOST = { 'academic-paper': 572, 'deep-research': 563 }

/** The one notice the served set still earns, and how many references it names. */
const PIPELINE_NOTICE_BYTES = 853
const PIPELINE_NOTICE_REFERENCES = 4

/** The vendored file count and how many of them are payload rather than markdown. */
const VENDORED_FILES = 342
const PAYLOAD_FILES = 120
/** Per-skill split: markdown + payload = the manifest's fileCount. */
const MARKDOWN_PER_SKILL = {
  'academic-paper': 62,
  'academic-paper-reviewer': 28,
  'academic-pipeline': 29,
  'deep-research': 53,
  'sr-screener': 15,
}
const PAYLOAD_PER_SKILL = {
  'academic-paper': 1,
  'academic-paper-reviewer': 0,
  'academic-pipeline': 1,
  'deep-research': 0,
  'sr-screener': 10,
}

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

/** The package name as the block's markers spell it - the shipped text, not package.json. */
const MARKER_NAME = WRITE_POLICY_BEGIN.slice('<!-- '.length, WRITE_POLICY_BEGIN.indexOf(':'))
/**
 * Every occurrence of the package name in a served payload that is NOT inside one of the
 * payload's own markers, as a description rather than a count: a hit has to be readable.
 */
function nameOutsideMarkers(content) {
  const boundaries = []
  for (const marker of [WRITE_POLICY_BEGIN, WRITE_POLICY_END, PORT_NOTICE_BEGIN, PORT_NOTICE_END]) {
    let at = content.indexOf(marker)
    while (at >= 0) {
      boundaries.push([at, at + marker.length])
      at = content.indexOf(marker, at + 1)
    }
  }
  const stray = []
  let position = content.indexOf(MARKER_NAME)
  while (position >= 0) {
    const contained = boundaries.some(([start, end]) => position >= start && position + MARKER_NAME.length <= end)
    if (contained === false) {
      stray.push('character ' + String(position) + ' in '
        + JSON.stringify(content.slice(Math.max(0, position - 24), position + 24)))
    }
    position = content.indexOf(MARKER_NAME, position + 1)
  }
  return stray
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
  assert.deepEqual(byExtension, { '.json': 109, '.py': 6, '.js': 2, '.tex': 1, '.yaml': 1, '.gitkeep': 1 },
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

  // A placeholder is allowed to be empty and nothing else is. academic-pipeline ships one
  // (.gitkeep, which exists to keep an otherwise-empty adapters/ directory), so the rule is
  // narrowed by NAME rather than dropped: an empty file that is not the known placeholder
  // still fails here.
  const PLACEHOLDERS = new Set(['academic-pipeline/references/adapters/.gitkeep'])
  let crFree = 0
  for (const name of payload) {
    const bytes = await readFile(join(vendorDir, name))
    if (PLACEHOLDERS.has(name)) {
      assert.equal(bytes.length, 0, name + ' is a placeholder, so emptiness is the whole of it')
      continue
    }
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
    // THE PACKAGE NAME MAY APPEAR ONLY INSIDE A MARKER, and a rename may not touch a body.
    // Measured against a copy of the pre-rename lib, when 0.5.0 renamed the package: the five
    // payloads differ at 12 / 12 / 24 / 12 / 12 bytes - one six-byte run per marker that names
    // the package, four for the pipeline, which also earns the port notice - every byte of
    // every run inside an occurrence of the name, and no payload changed length. Asserting the
    // positions rather than the count keeps that measurement durable: a body renamed along with
    // the package, or a marker-free mention of the name in a notice, fails here even while all
    // the byte counts above still match. (Positions are character offsets on both sides - the
    // name and the content are the same string - so no unit is mixed.)
    assert.deepEqual(nameOutsideMarkers(definition.content), [],
      skill + ': the package name may appear only inside the policy block or the notice')
    assert.equal(definition.content.split(MARKER_NAME).length - 1, notice.trim() === '' ? 2 : 4,
      skill + ': one marker name in each end of the block, plus one in each end of the notice')
    assert.equal(byteLength(definition.content), SERVED_BYTES[skill], skill + ': the served payload moved')
    // The CHANGE is the component check: a total can be right while a component is
    // wrong. A skill with no v0.4.1 total is an addition, and says so.
    const change = CHANGE_SINCE_V041[skill]
    if (V041_TOTALS[skill] === undefined) {
      assert.equal(change, SERVED_BYTES[skill], skill + ': a skill that was not served at v0.4.1 is recorded as an addition')
    } else {
      assert.equal(SERVED_BYTES[skill] - V041_TOTALS[skill], change,
        skill + ': the change since the v0.4.1 pin must be exactly ' + String(change) + ' byte(s)')
    }

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
      + '   change ' + String(change).padStart(6)
      + (inTable ? '  [' + PRODUCERS[skill] + ']' : ''))
  }

  // THE TOTAL, in bytes, and reconciled against the per-skill pins rather than typed in: both
  // this file and scripts/e2e.mjs read EXPECTED_SERVED_BYTES from tests/helpers.mjs, so the two
  // instruments report one number. The code-unit count is printed next to it, LABELLED as such -
  // String.length is UTF-16 code units, and the difference here is the multi-byte text in the
  // vendored descriptions and bodies. Anyone adding a CJK paragraph sees both units move apart
  // and knows which one the pins are in.
  const measuredTotal = SERVED_SKILLS.reduce((sum, skill) => sum + byteLengthOf(served.get(skill).content), 0)
  const measuredCodeUnits = SERVED_SKILLS.reduce((sum, skill) => sum + served.get(skill).content.length, 0)
  assert.deepEqual(Object.keys(SERVED_BYTES).sort(), [...SERVED_SKILLS].sort(),
    'the pinned payload map must cover exactly the served skills')
  assert.equal(measuredTotal, EXPECTED_SERVED_BYTES_TOTAL,
    'the five served payloads must total the sum of their pins, in bytes')
  assert.equal(measuredCodeUnits, measuredTotal - 4020,
    'the code-unit count differs from the byte count by the non-ASCII text; if this moves, a'
    + ' body changed character content, which is a payload change and not a unit change')
  console.log('# served total: ' + String(measuredTotal) + ' bytes (Buffer.byteLength utf8, = '
    + SERVED_SKILLS.map(skill => String(SERVED_BYTES[skill])).join(' + ') + ') = '
    + String(measuredCodeUnits) + ' UTF-16 code units - the 4020 gap is the non-ASCII text in the'
    + ' vendored bodies and descriptions')

  // The notice is a property of the tree, not of the skill: the two trees whose own
  // markdown names paths this port does not vendor carry one, the other two carry none.
  for (const skill of ['academic-paper-reviewer', 'sr-screener']) {
    const definition = served.get(skill)
    // Slice by CHARACTER offset (block.length + body.length); byteLength is for the
    // arithmetic only, and the two differ the moment a body holds a non-ASCII character.
    assert.equal(definition.content.slice(block.length + bodies.get(skill).length), '',
      skill + ' earns no port notice: every path its own markdown names is vendored')
  }
  //
  // academic-paper and deep-research USED to be in that list. They are asserted absent now,
  // with the arithmetic of the notice they lost, because the two ways this can go wrong are
  // opposite: a notice that quietly returns (a reference that stopped resolving) would be
  // invisible in a list that had simply dropped their names, and a shrink with no recorded
  // cause would look like a body that lost text.
  for (const [skill, formerNotice] of Object.entries(NOTICE_LOST)) {
    const definition = served.get(skill)
    const notice = definition.content.slice(block.length + bodies.get(skill).length)
    assert.equal(notice, '', skill + ' earns no port notice: the academic-pipeline tree now supplies every path its markdown names')
    assert.equal(formerNotice, -CHANGE_SINCE_V041[skill],
      skill + ' must have shrunk by exactly the notice it no longer needs, and by nothing else')
    assert.equal(SERVED_BYTES[skill], V041_TOTALS[skill] - formerNotice,
      skill + ': the body must be byte-identical to the v0.4.1 body; only the notice left')
  }

  // The one notice the served set still earns, asserted down to its size: a path that was
  // added to the tree and now resolves shows here as a smaller notice, and a path that
  // stopped resolving shows as a larger one.
  {
    const definition = served.get('academic-pipeline')
    const notice = definition.content.slice(block.length + bodies.get('academic-pipeline').length)
    assert.equal(byteLength(notice), PIPELINE_NOTICE_BYTES, 'the academic-pipeline port notice moved')
    assert.equal(definition.metadata.unavailableReferenceCount, PIPELINE_NOTICE_REFERENCES,
      'the notice must name exactly the references this port does not vendor')
  }

  // The table's two entries still describe two different measurements with two
  // different reasons. That is now documentation rather than a condition - the rule's
  // presence no longer depends on it - so a third skill arriving with a new reason is a
  // table edit and nothing else.
  const bases = Object.values(PRODUCERS)
  assert.equal(new Set(bases).size, Object.keys(PRODUCERS).length,
    'the table must keep one distinct basis per entry on record')
  const reasons = Object.keys(PRODUCERS).map(skill => fileProducingEntry(skill).reason)
  assert.equal(new Set(reasons).size, Object.keys(PRODUCERS).length, 'each table entry needs its own reason, not a shared one')
  for (const reason of reasons) {
    assert.equal(typeof reason, 'string', 'a table entry must carry a reason')
    assert.equal(reason.trim().includes(' '), true, 'the reason must be a sentence, not a label')
  }
  for (const skill of Object.keys(PRODUCERS)) {
    assert.equal(fileProducingEntry(skill).basis, PRODUCERS[skill], skill + ' must still qualify on ' + PRODUCERS[skill])
  }
  console.log('# attached rule: ' + String(BLOCK_BYTES) + ' bytes on all ' + String(SERVED_SKILLS.length)
    + ' skills; table reasons differ ('
    + Object.entries(PRODUCERS).map(([skill, basis]) => skill + ' -> ' + basis).join(', ')
    + ') and are documentation now')
  console.log('# academic-pipeline = block + body + notice(' + String(PIPELINE_NOTICE_BYTES) + '); academic-paper, '
    + 'academic-paper-reviewer, deep-research, sr-screener = block + body, no notice on this tree'
    + ' (academic-paper -' + String(NOTICE_LOST['academic-paper']) + ' and deep-research -'
    + String(NOTICE_LOST['deep-research']) + ' are former notices that the pipeline tree resolved)')
})

test('the name-confinement check bites: a body that spells the name is rejected', () => {
  // The check above is only worth having if it can fail. Two fixture payloads built from the
  // real markers: the canonical shape must be accepted, and the same shape with the package
  // name spelled in the body must be rejected - which is the edit a mechanical rename could
  // make by accident if a vendored body ever quoted the package name.
  const block = renderWritePolicyBlock()
  const notice = PORT_NOTICE_BEGIN + ' academic-pipeline: docs/ gone' + String.fromCharCode(10) + PORT_NOTICE_END
  const body = '# Fixture skill' + String.fromCharCode(10, 10) + 'A short fixture body.' + String.fromCharCode(10)
  assert.deepEqual(nameOutsideMarkers(block + body), [], 'the canonical payload must pass')
  assert.equal((block + body).split(MARKER_NAME).length - 1, 2, 'the canonical payload names the package twice')
  assert.deepEqual(nameOutsideMarkers(block + body + notice), [], 'a payload with a notice must pass')
  assert.equal((block + body + notice).split(MARKER_NAME).length - 1, 4, 'a payload with a notice names the package four times')
  const inBody = block + body.split('A short').join('A ' + MARKER_NAME + ' short')
  assert.equal(nameOutsideMarkers(inBody).length, 1, 'the name in a body must be reported')
  const bare = block + body + 'see ' + MARKER_NAME + ' for the rule' + String.fromCharCode(10)
  assert.equal(nameOutsideMarkers(bare).length, 1, 'a marker-free mention after the body must be reported')
})
