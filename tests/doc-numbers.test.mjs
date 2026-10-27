/**
 * The numbers the docs quote must equal the numbers the code measures (t25).
 *
 * README.md and docs/PORT_SPEC.md both state that academic-paper's body holds
 * "85 writing verbs and 46 drafting verbs", and PORT_SPEC adds "against 24 / 4
 * for the reviewer and 18 / 4 for deep-research". Those sentences are useful and
 * they are also a copy of a measurement, which is the shape of defect that has
 * already cost two rounds: a stale byte count in a report, then a stale verb
 * count inside src/write-policy.ts itself.
 *
 * So the docs are PARSED here (tests/doc-quoted-numbers.mjs) and compared with
 * fileProductionSignals() at run time, for whichever skills the docs happen to
 * name. This file contains no copy of the expected string - if it did, it would
 * just be a second place to rot.
 *
 * A document that stops quoting numbers is not a bug: it is skipped with a
 * diagnostic. A document that quotes a number the code disagrees with is.
 *
 * @module dsh-academic-review/tests/doc-numbers
 */

import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import { parseSkillDocument } from '../lib/skills.js'
import { fileProductionSignals } from '../lib/write-policy.js'
import { claimDrift, quotedClaims } from './doc-quoted-numbers.mjs'

const repoRoot = fileURLToPath(new URL('..', import.meta.url))

/** The documents that describe this port to a human, by path relative to the repo. */
const QUOTING_DOCS = ['README.md', join('docs', 'PORT_SPEC.md')]

/** fileProductionSignals() for one skill, measured from its vendored body. */
async function measure(skillName) {
  const raw = await readFile(join(repoRoot, 'vendor', skillName, 'SKILL.md'), 'utf8')
  return fileProductionSignals(parseSkillDocument(raw).body)
}

test('every file-production number the docs quote equals what fileProductionSignals() measures', async (t) => {
  const claims = []
  for (const doc of QUOTING_DOCS) {
    const text = await readFile(join(repoRoot, doc), 'utf8')
    const found = quotedClaims(text, doc)
    if (found.length === 0) {
      console.log('# ' + doc + ' quotes no file-production counts; nothing to pin there')
      continue
    }
    for (const claim of found) console.log('# ' + doc + ':' + String(claim.line) + ' claims ' + claim.skill
      + ' = ' + String(claim.writingVerbs) + ' writing / ' + String(claim.draftingVerbs) + ' drafting')
    claims.push(...found)
  }

  if (claims.length === 0) {
    t.skip('no document quotes file-production counts any more, so there is nothing to keep in sync')
    return
  }

  for (const claim of claims) {
    const measured = await measure(claim.skill)
    const drift = claimDrift(claim, measured)
    assert.equal(drift, undefined, drift ?? '')
    console.log('# ' + claim.doc + ':' + String(claim.line) + ' agrees with the measurement: '
      + claim.skill + ' = ' + String(measured.writingVerbs) + ' writing / ' + String(measured.draftingVerbs) + ' drafting')
  }

  // The docs describe the body the model reads, not the file on disk (which still
  // carries the frontmatter). Say so out loud, because "85" is only correct for one
  // of the two and a future editor will otherwise measure the wrong one.
  const paper = await measure('academic-paper')
  assert.equal(typeof paper.writingVerbs, 'number')
  console.log('# measurement is taken from the parsed body (frontmatter removed), the same text the provider serves')
})

test('the doc parser is not a rubber stamp: a doctored sentence produces the drift message', async () => {
  // Same wording as the docs, one number changed. If this did not fail, the test
  // above would be measuring nothing.
  const doctored = '`academic-paper` is the only vendored skill that instructs the model to write files - '
    + '84 writing verbs and 46 drafting verbs in its own body - which is why it is the single entry.'.split('`').join(String.fromCharCode(96))
  const claims = quotedClaims(doctored, 'README.md')
  assert.equal(claims.length, 1)
  assert.equal(claims[0].skill, 'academic-paper', 'the skill is taken from the nearest preceding name, not from the numbers')
  assert.equal(claims[0].writingVerbs, 84)
  assert.equal(claims[0].draftingVerbs, 46)

  const measured = await measure(claims[0].skill)
  const drift = claimDrift(claims[0], measured)
  assert.ok(drift !== undefined, 'a wrong number must produce a message')
  console.log('# drift message: ' + drift)
  assert.match(drift, /README\.md:\d+ says 84\/46 \(writing\/drafting\) for academic-paper, but fileProductionSignals\(academic-paper\) measures \d+\/\d+/u)

  // A sentence that quotes nothing is not a claim, and a doc that quotes nothing at
  // all must make the suite skip, not fail.
  assert.deepEqual(quotedClaims('It is the only vendored skill that writes files into the workspace.', 'README.md'), [])
  assert.deepEqual(quotedClaims('The reviewer drafts nothing.', 'README.md'), [])
  // The "against N / M for the reviewer and N / M for deep-research" clause is read
  // as two claims, both attributed to the skills it names.
  const against = quotedClaims('`academic-paper` is the writer - 85 writing verbs and 46 drafting verbs in its own body, against 24 / 4 for the reviewer and 18 / 4 for deep-research - so it carries policy A.', 'docs/PORT_SPEC.md')
  assert.deepEqual(against.map(claim => claim.skill), ['academic-paper', 'academic-paper-reviewer', 'deep-research'])
  assert.deepEqual(against.slice(1).map(claim => [claim.writingVerbs, claim.draftingVerbs]), [[24, 4], [18, 4]])
})
