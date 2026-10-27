/**
 * The numbers the docs quote must equal the numbers the code measures (t25, t26).
 *
 * English and Chinese documents are parsed alike: the docs quote three kinds of
 * measurement in prose - file-production verb counts, the repository-byte size of
 * a skill's SKILL.md, and the shared-scope "N distinct references (M sites)" - and
 * every one of those is a copy of something the code computes. Rounds one to three
 * were all spent on copies of measurements that stopped being true.
 *
 * t25 was monolingual: README.zh-CN.md:69 says the same thing in Chinese
 * ("85 `个写作动词`、46 `个起草动词`"), the parser only knew English, so that
 * document could disagree with README.md and with the measurement and the whole
 * suite stayed green. The clauses are now derived per language in
 * tests/doc-quoted-numbers.mjs - same numeric tokens, language-specific separators -
 * and this file asserts that a Chinese document is read as Chinese, not tolerated.
 *
 * Skip semantics are deliberate: a document that stops quoting a number is not a
 * bug, so it is skipped with a diagnostic instead of failing.
 *
 * @module dsh-academic-review/tests/doc-numbers
 */

import assert from 'node:assert/strict'
import { readFile, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import {
  PLACEHOLDER,
  existsInside,
  missingReferencesByScope,
  normalizeReference,
  referencesIn,
  resolveReference,
} from '../lib/references.js'
import { defaultVendorBasePath, parseSkillDocument } from '../lib/skills.js'
import { fileProductionSignals } from '../lib/write-policy.js'
import { CLAIM_KINDS, claimDrift, quotedClaims } from './doc-quoted-numbers.mjs'

const repoRoot = fileURLToPath(new URL('..', import.meta.url))
const vendorBasePath = defaultVendorBasePath()

/**
 * Every document that describes the CURRENT tree and quotes a measurement in prose.
 *
 * CHANGELOG.md is deliberately absent: a changelog entry records a release that
 * already happened, so "0.3.0 shipped 65,335 bytes" stays true after the next
 * re-vendor. Pinning it would turn a true sentence red on the first legitimate
 * re-vendor, and the only remedy this mechanism offers is editing that sentence -
 * a test must never push someone to falsify a record. Freshness belongs at
 * release time (assert the NEWEST section then), not in a permanent pin.
 */
const QUOTING_DOCS = ['README.md', 'README.zh-CN.md', join('docs', 'PORT_SPEC.md')]

/** fileProductionSignals() for one skill, measured from its vendored body. */
async function measureFileProduction(skillName) {
  const raw = await readFile(join(vendorBasePath, skillName, 'SKILL.md'), 'utf8')
  return fileProductionSignals(parseSkillDocument(raw).body)
}

/** The real on-disk size of a skill's SKILL.md - not a number typed into a test. */
async function measureRepositoryBytes(skillName) {
  const info = await stat(join(vendorBasePath, skillName, 'SKILL.md'))
  return { bytes: info.size }
}

const scopeCache = new Map()
/** The shared/ closure the provider itself walks: distinct misses and the sites naming them. */
async function measureSharedScope() {
  const cached = scopeCache.get('shared')
  if (cached !== undefined) return cached
  const scopes = await missingReferencesByScope({ vendorBasePath, skillName: 'academic-paper-reviewer' })
  const targets = new Set()
  let sites = 0
  for (const file of scopes.sharedFiles) {
    const text = await readFile(join(vendorBasePath, file), 'utf8')
    for (const reference of referencesIn(file, text)) {
      const raw = normalizeReference(reference.raw)
      if (raw === '' || PLACEHOLDER.test(raw)) continue
      const target = resolveReference(file, raw, reference.kind)
      if (await existsInside(vendorBasePath, target)) continue
      sites += 1
      targets.add(target)
    }
  }
  const measured = { distinct: scopes.shared.length, sites }
  assert.equal(targets.size, scopes.shared.length, 'the provider and this counter must agree on the distinct targets')
  scopeCache.set('shared', measured)
  return measured
}

/** The measurement a claim is about, taken from live code. */
async function measure(claim) {
  if (claim.kind === 'file-production') return measureFileProduction(claim.skill)
  if (claim.kind === 'repository-bytes') return measureRepositoryBytes(claim.skill)
  return measureSharedScope()
}

/** Every claim the documents make, with per-document skip diagnostics. */
async function collectClaims(log) {
  const claims = []
  for (const doc of QUOTING_DOCS) {
    const text = await readFile(join(repoRoot, doc), 'utf8')
    const found = quotedClaims(text, doc)
    if (found.length === 0) {
      log('# ' + doc + ' quotes no measurement this test knows; nothing to pin there')
      continue
    }
    for (const claim of found) {
      log('# ' + doc + ':' + String(claim.line) + ' [' + claim.language + '] claims ' + claim.kind + ' '
        + (claim.skill ?? 'shared-scope') + ' = ' + JSON.stringify(claim.quote).slice(0, 96))
    }
    claims.push(...found)
  }
  return claims
}

test('every number the docs quote, in any language, equals what the code measures', async (t) => {
  const claims = await collectClaims(line => console.log(line))
  if (claims.length === 0) {
    t.skip('no document quotes a measurement any more, so there is nothing to keep in sync')
    return
  }

  for (const claim of claims) {
    const measured = await measure(claim)
    const drift = claimDrift(claim, measured)
    assert.equal(drift, undefined, drift ?? '')
    console.log('# ' + claim.doc + ':' + String(claim.line) + ' [' + claim.language + '] agrees: '
      + claim.kind + ' ' + (claim.skill ?? 'shared-scope') + ' = ' + JSON.stringify(measured))
  }

  // A Chinese document must be read as Chinese. If the clauses were English-only,
  // this file would fall through to "quotes nothing" and skip - indistinguishable
  // in the log from a document that legitimately stopped quoting numbers. So the
  // Chinese document is required to yield Chinese claims whenever it yields any,
  // and the self-check below proves the Chinese clauses match Chinese prose.
  for (const doc of QUOTING_DOCS.filter(name => name.includes('.zh-CN.'))) {
    const fromDoc = claims.filter(claim => claim.doc === doc)
    if (fromDoc.length === 0) {
      console.log('# ' + doc + ' is Chinese but quoted nothing this parser understands - see the self-check test')
      continue
    }
    assert.deepEqual([...new Set(fromDoc.map(claim => claim.language))], ['Chinese'],
      doc + ' must be parsed as Chinese, not silently skipped by an English-only clause')
  }
})

test('the parser reads both languages and is not a rubber stamp in either', async () => {
  // English: one wrong number, and the message names the file, the line, the
  // language, both values and the measuring function.
  const englishClaim = quotedClaims('`academic-paper` is the only vendored skill that writes - 84 writing verbs and 46 drafting verbs in its own body.', 'README.md')[0]
  assert.equal(englishClaim.language, 'English')
  assert.equal(englishClaim.skill, 'academic-paper')
  const englishDrift = claimDrift(englishClaim, await measureFileProduction('academic-paper'))
  assert.match(englishDrift, /README\.md:1 \(English\) says academic-paper is 84\/46 \(writing\/drafting\), but fileProductionSignals\(academic-paper\) measures 85\/46/u)
  console.log('# English drift: ' + englishDrift)

  // Chinese: the same sentence translated, one wrong number, phrased with no
  // spaces and an ideographic comma - the shape t25 could not see at all.
  const chinese = '`academic-paper` 是本移植中唯一会写文件的技能 —— 其正文里有 86 个写作动词、46 个起草动词 —— 所以它带着策略 A。'
  const chineseClaim = quotedClaims(chinese, 'README.zh-CN.md')[0]
  assert.equal(chineseClaim.language, 'Chinese', 'the Chinese clause must match Chinese prose')
  assert.equal(chineseClaim.skill, 'academic-paper')
  assert.deepEqual([chineseClaim.writingVerbs, chineseClaim.draftingVerbs], [86, 46])
  const chineseDrift = claimDrift(chineseClaim, await measureFileProduction('academic-paper'))
  assert.match(chineseDrift, /README\.zh-CN\.md:1 \(Chinese\) says academic-paper is 86\/46 \(writing\/drafting\), but fileProductionSignals\(academic-paper\) measures 85\/46/u)
  console.log('# Chinese drift: ' + chineseDrift)

  // The two languages do not read each other's prose: an English sentence yields
  // no Chinese claim and a Chinese sentence yields no English claim.
  assert.deepEqual(quotedClaims(chinese, 'x'), quotedClaims(chinese, 'x').filter(claim => claim.language === 'Chinese'))
  assert.equal(quotedClaims(chinese, 'x').every(claim => claim.language === 'Chinese'), true)
  assert.equal(quotedClaims('85 writing verbs and 46 drafting verbs', 'x').every(claim => claim.language === 'English'), true)

  // Repository bytes, both languages, with thousands separators as the docs write them.
  // A claim must still name its skill: a size with no skill in the sentence is
  // skipped, not attributed to whichever skill happens to be nearby.
  const bytesEnglish = quotedClaims('`academic-paper` ships 63 files and its `SKILL.md`, 65,335 repository bytes)', 'README.md')[0]
  assert.equal(bytesEnglish.bytes, 65335)
  assert.equal(claimDrift(bytesEnglish, { bytes: 65335 }), undefined)
  const bytesDrift = claimDrift({ ...bytesEnglish, bytes: 65330 }, { bytes: 65335 })
  assert.match(bytesDrift, /says SKILL.md of academic-paper is 65330 repository bytes, but the vendored vendor\/academic-paper\/SKILL\.md measures 65335/u)
  const bytesChinese = quotedClaims('`academic-paper` 的 `SKILL.md`，仓库字节数 65,335）', 'README.zh-CN.md')[0]
  assert.equal(bytesChinese.language, 'Chinese')
  assert.equal(bytesChinese.bytes, 65335)

  // Shared scope: both numbers, both languages.
  const scopeEnglish = quotedClaims('contain **11 distinct references** (16 reference sites) to upstream areas', 'README.md')[0]
  assert.deepEqual([scopeEnglish.distinct, scopeEnglish.sites], [11, 16])
  const scopeDrift = claimDrift({ ...scopeEnglish, sites: 14 }, { distinct: 11, sites: 16 })
  assert.match(scopeDrift, /README\.md:1 \(English\) says the shared\/ scope is 11 distinct references over 14 reference sites, but missingReferencesByScope\(\) measures 11 distinct references over 16 reference sites/u)
  const scopeChinese = quotedClaims('含有 **11 个不同**\n引用（16 处引用位置）指向本移植未随附的上游目录', 'README.zh-CN.md')[0]
  assert.equal(scopeChinese.language, 'Chinese')
  assert.deepEqual([scopeChinese.distinct, scopeChinese.sites], [11, 16])

  // A document that quotes none of the three kinds is not a claim and must not
  // fail: this is the skip path, exercised here so it cannot rot.
  assert.deepEqual(quotedClaims('It is the only vendored skill that writes files into the workspace.', 'README.md'), [])
  assert.deepEqual(quotedClaims('它是唯一会写文件的技能。', 'README.zh-CN.md'), [])
})

/** The bilingual pair, and the language each document is written in. */
const BILINGUAL = { 'README.md': 'English', 'README.zh-CN.md': 'Chinese' }

/** The numbers one claim asserts, as plain data: what the two languages must share. */
function numbersOf(claim) {
  if (claim.kind === 'file-production') return { writingVerbs: claim.writingVerbs, draftingVerbs: claim.draftingVerbs }
  if (claim.kind === 'repository-bytes') return { bytes: claim.bytes }
  return { distinct: claim.distinct, sites: claim.sites }
}

/** A claim as a comparable string, for "these two sentences say the same thing". */
function projection(claim) {
  return JSON.stringify({ skill: claim.skill ?? null, ...numbersOf(claim) })
}

/** A claim as prose, for a message that has to name what each side said. */
function describeClaim(claim) {
  const where = claim.doc + ':' + String(claim.line) + ' (' + claim.language + ')'
  const subject = claim.kind === 'shared-scope' ? 'the shared/ scope' : claim.kind === 'repository-bytes' ? 'SKILL.md of ' + claim.skill : claim.skill
  const numbers = claim.kind === 'file-production'
    ? claim.writingVerbs + '/' + claim.draftingVerbs + ' (writing/drafting)'
    : claim.kind === 'repository-bytes'
      ? claim.bytes + ' repository bytes'
      : claim.distinct + ' distinct references over ' + claim.sites + ' reference sites'
  return where + ' says ' + subject + ' is ' + numbers
}

test('the English and Chinese READMEs tell the same story, or the disagreement is named', async (t) => {
  // t26 asserted that README.zh-CN.md quotes one claim of each kind. That guard
  // contradicted the module's own promise: the header says a document that stops
  // quoting a number is skipped with a diagnostic, yet retiring a number from the
  // Chinese README failed the suite and invited someone to edit a test to retire it
  // from the documents. The failure that actually matters is not "fewer claims than
  // yesterday" but THE TWO LANGUAGES DISAGREE. So this test compares the pair:
  //   - one language quotes a measurement and the other does not -> fail, naming both;
  //   - both quote it with different values                      -> fail, naming both;
  //   - neither quotes it                                         -> skip it, loudly.
  // Retiring a number from both READMEs therefore needs no edit here.
  const claimsByDoc = {}
  for (const doc of Object.keys(BILINGUAL)) {
    claimsByDoc[doc] = quotedClaims(await readFile(join(repoRoot, doc), 'utf8'), doc)
    // A document written in Chinese must be read by the Chinese clauses. If it were
    // read by an English-only pass it would look exactly like a document that had
    // stopped quoting numbers, and the pair could disagree with impunity.
    if (claimsByDoc[doc].length > 0) {
      assert.deepEqual([...new Set(claimsByDoc[doc].map(claim => claim.language))], [BILINGUAL[doc]],
        doc + ' must be read as ' + BILINGUAL[doc] + ', never by another language\'s clauses')
    }
  }

  let compared = 0
  const retired = []
  for (const kind of CLAIM_KINDS) {
    const sides = Object.keys(BILINGUAL).map(doc => ({
      doc,
      language: BILINGUAL[doc],
      claims: claimsByDoc[doc].filter(claim => claim.kind === kind),
    }))
    const quoting = sides.filter(side => side.claims.length > 0)
    if (quoting.length === 0) {
      retired.push(kind)
      console.log('# neither README quotes a ' + kind + ' any more; nothing for the two languages to disagree about')
      continue
    }
    if (quoting.length === 1) {
      const [only] = quoting
      const silent = sides.find(side => side.claims.length === 0)
      assert.fail('the two languages disagree about the ' + kind + ': ' + describeClaim(only.claims[0])
        + ', but ' + silent.doc + ' (' + silent.language + ') quotes no ' + kind + ' at all'
        + ' - a bilingual pair must not say it in one language only; quote it in both, or retire it from both')
    }
    const [first, second] = sides
    assert.deepEqual(
      [...second.claims.map(projection)].sort(),
      [...first.claims.map(projection)].sort(),
      'the two languages disagree about the ' + kind + ': ' + first.claims.map(describeClaim).join('; ')
      + ' versus ' + second.claims.map(describeClaim).join('; ')
      + ' - both documents quote this measurement, so both must say the same thing, and both must match the code')
    compared += 1
    console.log('# ' + first.doc + ' and ' + second.doc + ' agree about the ' + kind + ': '
      + first.claims.map(describeClaim).join('; '))
  }

  if (compared === 0) {
    t.skip('neither README quotes a measurement any more, so the two languages have nothing to disagree about')
    return
  }
  console.log('# compared ' + String(compared) + ' measurement(s) across the bilingual pair'
    + (retired.length > 0 ? '; retired from both: ' + retired.join(', ') : ''))
})
