/**
 * The numbers the docs quote must equal the numbers the code measures (t25, t26, t56).
 *
 * English and Chinese documents are parsed alike: the docs quote five kinds of
 * measurement in prose - file-production verb counts, the repository-byte size of a
 * skill's SKILL.md, the shared-scope "N distinct references (M sites)", the same verb
 * counts written as a MARGIN ("39 writing verbs / 18 drafting verbs", the shape every
 * document that quotes academic-pipeline's near miss uses), and the thresholds
 * themselves ("40 and 20", "writing verbs ≥ 40") - and every one of those is a copy of
 * something the code computes. Rounds one to three
 * were all spent on copies of measurements that stopped being true.
 *
 * t25 was monolingual: README.zh-CN.md:69 says the same thing in Chinese
 * ("85 `个写作动词`、46 `个起草动词`"), the parser only knew English, so that
 * document could disagree with README.md and with the measurement and the whole
 * suite stayed green. The clauses are now derived per language in
 * tests/doc-quoted-numbers.mjs - same numeric tokens, language-specific separators -
 * and this file asserts that a Chinese document is read as Chinese, not tolerated.
 *
 * t35: attribution is scoped to the CLAIM'S OWN SENTENCE, and the pair test compares
 * per (measurement, subject) rather than per measurement. Until then a number quoted
 * about sr-screener was attributed to the nearest skill named before it - in practice
 * academic-paper, paragraphs earlier - so the fourth skill's counts were the only ones
 * in the docs that nothing could pin, and the sentence was rephrased instead. A claim
 * naming its skill anywhere in its own sentence can no longer fall through to a
 * neighbour, and one language quoting sr-screener while the other does not is reported
 * as exactly that.
 *
 * Skip semantics are deliberate: a document that stops quoting a number is not a
 * bug, so it is skipped with a diagnostic instead of failing.
 *
 * @module dsh-academic-skills/tests/doc-numbers
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
import {
  FILE_PRODUCING_MIN_DRAFTING_VERBS,
  FILE_PRODUCING_MIN_WRITING_VERBS,
  fileProductionSignals,
} from '../lib/write-policy.js'
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
  if (claim.kind === 'file-production' || claim.kind === 'verb-margin') return measureFileProduction(claim.skill)
  if (claim.kind === 'drafting-floors') {
    // The thresholds ARE numbers the documents print, so they are measured against the
    // constants the detector uses, never against literals typed into this file.
    return { writingFloor: FILE_PRODUCING_MIN_WRITING_VERBS, draftingFloor: FILE_PRODUCING_MIN_DRAFTING_VERBS }
  }
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
        + (claim.skill ?? claim.kind) + ' = ' + JSON.stringify(claim.quote).slice(0, 96))
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
      + claim.kind + ' ' + (claim.skill ?? claim.kind) + ' = ' + JSON.stringify(measured))
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

  // A document that quotes none of the kinds is not a claim and must not
  // fail: this is the skip path, exercised here so it cannot rot.
  assert.deepEqual(quotedClaims('It is the only vendored skill that writes files into the workspace.', 'README.md'), [])
  assert.deepEqual(quotedClaims('它是唯一会写文件的技能。', 'README.zh-CN.md'), [])
})

/** The bilingual pair, and the language each document is written in. */
const BILINGUAL = { 'README.md': 'English', 'README.zh-CN.md': 'Chinese' }

/** The numbers one claim asserts, as plain data: what the two languages must share. */
function numbersOf(claim) {
  if (claim.kind === 'file-production' || claim.kind === 'verb-margin') return { writingVerbs: claim.writingVerbs, draftingVerbs: claim.draftingVerbs }
  if (claim.kind === 'drafting-floors') return { writingFloor: claim.writingFloor, draftingFloor: claim.draftingFloor }
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
  const subject = claim.kind === 'shared-scope'
    ? 'the shared/ scope'
    : claim.kind === 'drafting-floors' ? 'the drafting thresholds'
      : claim.kind === 'repository-bytes' ? 'SKILL.md of ' + claim.skill : claim.skill
  const numbers = claim.kind === 'file-production' || claim.kind === 'verb-margin'
    ? claim.writingVerbs + '/' + claim.draftingVerbs + ' (writing/drafting)'
    : claim.kind === 'drafting-floors'
      ? claim.writingFloor + ' writing / ' + claim.draftingFloor + ' drafting'
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
    // Compare per SUBJECT, not per kind. A kind-level comparison lets one skill's
    // numbers stand in for another's: with four skills of the same shape, "both
    // languages quote repository bytes" can be satisfied twice over while sr-screener
    // is quoted in English only and academic-paper in both. The compound a bilingual
    // pair must agree on is (measurement, subject) - the same unit the drift check
    // uses when it measures a claim, so parity and correctness cannot disagree about
    // what a claim is about.
    const subjects = [...new Set(Object.keys(BILINGUAL).flatMap(doc => claimsByDoc[doc]
      .filter(claim => claim.kind === kind)
      .map(claim => claim.skill ?? null)))].sort((left, right) => String(left).localeCompare(String(right)))
    if (subjects.length === 0) {
      retired.push(kind)
      console.log('# neither README quotes a ' + kind + ' any more; nothing for the two languages to disagree about')
      continue
    }
    for (const subject of subjects) {
      const sides = Object.keys(BILINGUAL).map(doc => ({
        doc,
        language: BILINGUAL[doc],
        claims: claimsByDoc[doc].filter(claim => claim.kind === kind && (claim.skill ?? null) === subject),
      }))
      const about = kind + (subject === null ? '' : ' (' + subject + ')')
      const quoting = sides.filter(side => side.claims.length > 0)
      if (quoting.length === 1) {
        const [only] = quoting
        const silent = sides.find(side => side.claims.length === 0)
        assert.fail('the two languages disagree about the ' + about + ': ' + describeClaim(only.claims[0])
          + ', but ' + silent.doc + ' (' + silent.language + ') quotes no ' + kind + ' for '
          + (subject ?? 'the shared/ scope') + ' at all'
          + ' - a bilingual pair must not say it in one language only; quote it in both, or retire it from both')
      }
      const [first, second] = sides
      assert.deepEqual(
        [...second.claims.map(projection)].sort(),
        [...first.claims.map(projection)].sort(),
        'the two languages disagree about the ' + about + ': ' + first.claims.map(describeClaim).join('; ')
        + ' versus ' + second.claims.map(describeClaim).join('; ')
        + ' - both documents quote this measurement, so both must say the same thing, and both must match the code')
      compared += 1
      console.log('# ' + first.doc + ' and ' + second.doc + ' agree about the ' + about + ': '
        + first.claims.map(describeClaim).join('; '))
    }
  }

  if (compared === 0) {
    t.skip('neither README quotes a measurement any more, so the two languages have nothing to disagree about')
    return
  }
  console.log('# compared ' + String(compared) + ' measurement(s) across the bilingual pair'
    + (retired.length > 0 ? '; retired from both: ' + retired.join(', ') : ''))
})

test('a number quoted about the fourth skill is measured against the fourth skill, never its neighbour', async (t) => {
  // WHAT WENT WRONG (t35): the parser attributed every claim to the nearest skill name
  // BEFORE it, anywhere in the document. Until this round the table had no entry for
  // sr-screener, so a sentence quoting its numbers was attributed to academic-paper -
  // the skill named two paragraphs earlier - and the pinner then compared sr-screener's
  // counts with academic-paper's body (85/46) or sr-screener's SKILL.md size with
  // academic-paper's (65,335). The claim it produced was never true; it merely failed
  // in the wrong place, which is why docs-writer rephrased the sentence instead of
  // pinning it, and why the fourth skill's counts became the only numbers in the docs
  // that nothing pinned. Attribution is now scoped to the claim's own sentence, so a
  // name in that sentence decides the claim whether it comes before or after the number.
  const shapes = [
    ['`sr-screener` qualifies the other way: 24 writing verbs and 3 drafting verbs in its own body.', 'sr-screener'],
    ['24 writing verbs and 3 drafting verbs in its own body - that is `sr-screener`.', 'sr-screener'],
    ['`sr-screener` ships 25 files and its `SKILL.md`, 33,843 repository bytes.', 'sr-screener'],
    ['`sr-screener` 的 `SKILL.md`，仓库字节数 33,843）', 'sr-screener'],
    ['`sr-screener` 其正文里有 24 个写作动词、3 个起草动词。', 'sr-screener'],
    // Two names in ONE sentence: attribution falls back to the nearest one before the
    // number, which is the rule that built the corpus, not a new one.
    ['`academic-paper` drafts and `sr-screener` runs scripts; `academic-paper` quotes 85 writing verbs and 46 drafting verbs here.', 'academic-paper'],
  ]
  for (const [text, expected] of shapes) {
    const [claim] = quotedClaims(text, 'README.md')
    assert.ok(claim !== undefined, 'the parser must see a claim in: ' + text)
    assert.equal(claim.skill, expected, 'attributed "' + text.slice(0, 60) + '" to ' + claim.skill)
  }
  console.log('# ' + String(shapes.length) + ' sr-screener/neighbour shapes all attributed to the skill the sentence names')

  // THE MUTATION, kept in the suite so it cannot rot - and built so that it cannot
  // depend on WHAT the document currently says.
  //
  // The first version appended a wrong 33,844 to a copy of the README. It proved the
  // point only while the document quoted no sr-screener size at all: the day the true
  // 33,843 came back (t36), the appended sentence was a second claim on the same
  // subject, the parser kept one of them, and claimDrift returned undefined - a
  // mutation that passes. A proof whose validity depends on the state of the thing it
  // is testing proves nothing. So this one reads whatever the document says: if it
  // quotes a size for the fourth skill it REWRITES that number in the copy, if it does
  // not it inserts the sentence, and EITHER WAY it asserts the text actually changed
  // before it asserts anything about the failure. A silent no-op fails here, at the
  // mutation site, with a message saying the fixture is stale rather than the pinner.
  //
  // DSH_DOC_FIXTURE_README exists so this can be run against another version of the
  // same document (git show HEAD:README.md materialised to a temp file) and shown
  // green in both states. It affects nothing else in this file.
  const fixtureDoc = process.env.DSH_DOC_FIXTURE_README ?? join(repoRoot, 'README.md')
  const fixtureName = fixtureDoc.split(/[\\/]/u).pop() ?? 'README.md'
  const fixtureReadme = await readFile(fixtureDoc, 'utf8')
  const measuredBytes = (await measureRepositoryBytes('sr-screener')).bytes

  /** The document with sr-screener's quoted size set to `bytes`; inserts a claim if it quotes none. */
  const doctorSrBytes = (text, bytes) => {
    const quoted = quotedClaims(text, fixtureName)
      .find(claim => claim.kind === 'repository-bytes' && claim.skill === 'sr-screener')
    if (quoted === undefined) {
      return {
        text: text + '\n`sr-screener` ships 25 files and its `SKILL.md`, ' + String(bytes) + ' repository bytes.\n',
        how: 'inserted a claim in',
      }
    }
    // By offset, not by searching for the quote: the quote is whitespace-collapsed for
    // messages and need not appear in the raw text (the docs wrap lines mid-phrase).
    const raw = text.slice(quoted.index, quoted.index + quoted.length)
    const rewritten = raw.replace(/[\d,]{3,}/u, String(bytes))
    assert.notEqual(rewritten, raw, 'the sr-screener size claim ' + JSON.stringify(quoted.quote)
      + ' carries no number to rewrite - the fixture is stale, not the pinner')
    return {
      text: text.slice(0, quoted.index) + rewritten + text.slice(quoted.index + quoted.length),
      how: 'rewrote the claim in',
    }
  }

  const doctored = doctorSrBytes(fixtureReadme, measuredBytes + 1)
  assert.notEqual(doctored.text, fixtureReadme,
    'the mutation changed nothing: it could not find sr-screener\'s repository-bytes claim to doctor,'
    + ' so this proof would assert nothing - the fixture is stale, not the pinner')
  const srBytes = quotedClaims(doctored.text, fixtureName)
    .find(claim => claim.kind === 'repository-bytes' && claim.skill === 'sr-screener')
  assert.ok(srBytes !== undefined, 'the doctored document must still yield a sr-screener size claim')
  assert.equal(srBytes.bytes, measuredBytes + 1,
    'the doctor did not take effect: the claim reads ' + String(srBytes.bytes) + ', not ' + String(measuredBytes + 1))
  const srDrift = claimDrift(srBytes, await measure(srBytes))
  assert.match(srDrift, /sr-screener/u, 'the failure must name sr-screener: ' + srDrift)
  assert.match(srDrift, /vendor\/sr-screener\/SKILL\.md/u, 'the failure must name sr-screener\'s own file: ' + srDrift)
  assert.match(srDrift, new RegExp(String(measuredBytes + 1), 'u'))
  assert.doesNotMatch(srDrift, /academic-paper/u, 'a sr-screener claim must never be validated against academic-paper: ' + srDrift)
  console.log('# ' + doctored.how + ' ' + fixtureName + ' to ' + String(measuredBytes + 1) + ' -> ' + srDrift)

  // ...and the same copy with the measured number is clean, so the shape reported to
  // docs-writer is a shape that passes. Taken from the same document, not from a
  // sentence typed here, so it stays true across a re-write of the prose.
  const corrected = doctorSrBytes(fixtureReadme, measuredBytes)
  const correctedClaim = quotedClaims(corrected.text, fixtureName)
    .find(claim => claim.kind === 'repository-bytes' && claim.skill === 'sr-screener')
  assert.ok(correctedClaim !== undefined, 'the corrected copy must still yield a sr-screener size claim')
  assert.equal(claimDrift(correctedClaim, await measure(correctedClaim)), undefined,
    'the measured number must be clean in the same sentence that the doctored number fails')

  // Verb counts, same shape, same guarantee, English and Chinese.
  const english = quotedClaims('`sr-screener` qualifies by running its scripts: 24 writing verbs and 4 drafting verbs in its own body.', 'README.md')[0]
  const englishDrift = claimDrift(english, await measureFileProduction('sr-screener'))
  assert.match(englishDrift, /says sr-screener is 24\/4 \(writing\/drafting\), but fileProductionSignals\(sr-screener\) measures 24\/3/u)
  assert.doesNotMatch(englishDrift, /academic-paper/u)
  const chinese = quotedClaims('`sr-screener` 其正文里有 24 个写作动词、4 个起草动词。', 'README.zh-CN.md')[0]
  const chineseDrift = claimDrift(chinese, await measureFileProduction('sr-screener'))
  assert.match(chineseDrift, /says sr-screener is 24\/4 \(writing\/drafting\), but fileProductionSignals\(sr-screener\) measures 24\/3/u)
  console.log('# sr-screener verb counts, both languages: ' + englishDrift)

  // The two producers must not be interchangeable: if the fourth skill's numbers were
  // accepted against the third skill's body, this comparison would be the reason.
  const paper = await measureFileProduction('academic-paper')
  const screener = await measureFileProduction('sr-screener')
  assert.notDeepEqual([paper.writingVerbs, paper.draftingVerbs], [screener.writingVerbs, screener.draftingVerbs],
    'the two producers must not measure the same, or this test would pass for the wrong reason')
  console.log('# the two producers differ as measured: academic-paper ' + paper.writingVerbs + '/' + paper.draftingVerbs
    + ' versus sr-screener ' + screener.writingVerbs + '/' + screener.draftingVerbs)
})

/**
 * The four documents that quote academic-pipeline's verb counts. Every one of them said it in
 * prose before this test existed, and none of them was checked: the counts are printed by the
 * suite every run and stored nowhere in code, deliberately, so the one number the code refuses
 * to store was the only number nothing verified - four places, four ways to drift.
 */
const PIPELINE_VERB_DOCS = ['README.md', 'README.zh-CN.md', join('docs', 'PORT_SPEC.md'), 'CHANGELOG.md']

/** Documents that print the thresholds themselves next to those counts. */
const FLOOR_DOCS = ['README.md', 'README.zh-CN.md', join('docs', 'PORT_SPEC.md')]

/** Escape a document name for use inside a regular expression. */
function literal(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')
}

/**
 * One document with its quoted count rewritten, by offset rather than by searching for the
 * quote: the quote is whitespace-collapsed for messages and need not appear in the raw text.
 * Returns the text and the claim the doctor found, so a silent no-op cannot pass as a proof.
 */
function doctorQuotedNumber(text, doc, kind, skill, from, to) {
  const claim = quotedClaims(text, doc)
    .find(found => found.kind === kind && (found.skill ?? null) === skill)
  assert.ok(claim !== undefined, doc + ' quotes no ' + kind + ' claim to doctor - the fixture is stale')
  const raw = text.slice(claim.index, claim.index + claim.length)
  const rewritten = raw.replace(String(from), String(to))
  assert.notEqual(rewritten, raw, 'the ' + kind + ' claim in ' + doc + ' carries no ' + String(from)
    + ' to rewrite - the fixture is stale, not the pinner')
  return { text: text.slice(0, claim.index) + rewritten + text.slice(claim.index + claim.length), claim: { ...claim, index: claim.index } }
}

test('the pipeline\'s verb counts are pinned in all four documents, and the pin bites in each', async (t) => {
  const measured = await measureFileProduction('academic-pipeline')
  const floors = {
    writingFloor: FILE_PRODUCING_MIN_WRITING_VERBS,
    draftingFloor: FILE_PRODUCING_MIN_DRAFTING_VERBS,
  }
  t.diagnostic('academic-pipeline measures ' + String(measured.writingVerbs) + ' writing / '
    + String(measured.draftingVerbs) + ' drafting against floors of ' + String(floors.writingFloor)
    + ' / ' + String(floors.draftingFloor))

  // The sentences also claim POSITION, not just counts: 'a near miss on both thresholds',
  // 'both under the thresholds', '对两条起草阈值都是擦边未过'. That claim is true only while the
  // measured counts sit below the floors, so it is asserted here rather than read out of the
  // prose - if the pipeline ever clears a threshold, its recorded basis is dead and the
  // documents that call it a near miss are wrong.
  assert.ok(measured.writingVerbs < floors.writingFloor,
    'the documents call this a near miss on writing verbs, but the body measures '
    + String(measured.writingVerbs) + ' against a floor of ' + String(floors.writingFloor))
  assert.ok(measured.draftingVerbs < floors.draftingFloor,
    'the documents call this a near miss on drafting verbs, but the body measures '
    + String(measured.draftingVerbs) + ' against a floor of ' + String(floors.draftingFloor))

  const quoting = []
  for (const doc of PIPELINE_VERB_DOCS) {
    const text = await readFile(join(repoRoot, doc), 'utf8')
    const claims = quotedClaims(text, doc).filter(claim => claim.kind === 'verb-margin')
    assert.equal(claims.length, 1, doc + ' must quote the pipeline\'s counts exactly once, as\n'
      + '  "39 writing verbs / 18 drafting verbs" (or its Chinese equivalent), because that shape\n'
      + '  is what makes them checkable. Found ' + String(claims.length) + ': '
      + JSON.stringify(claims.map(claim => claim.quote)))
    const [claim] = claims
    // Attribution is half the check: a claim about the pipeline measured against the reviewer
    // would pass on numbers that were never about it.
    assert.equal(claim.skill, 'academic-pipeline',
      doc + ':' + String(claim.line) + ' quotes counts but names no skill in its own sentence; '
      + 'it was attributed to ' + String(claim.skill ?? 'nothing'))
    assert.equal(claimDrift(claim, measured), undefined, 'the quoted counts must equal what the body measures')
    quoting.push({ doc, text, claim })
    console.log('# ' + describeClaim(claim) + ' -> measured ' + String(measured.writingVerbs)
      + '/' + String(measured.draftingVerbs))
  }
  assert.equal(quoting.length, PIPELINE_VERB_DOCS.length, 'all four documents must be pinned')

  // THE THRESHOLDS, where a document prints them. CHANGELOG.md says 'under both thresholds'
  // without numbers, so it contributes nothing here; the other three print 40 and 20 and are
  // measured against the constants.
  for (const doc of FLOOR_DOCS) {
    const text = await readFile(join(repoRoot, doc), 'utf8')
    const claims = quotedClaims(text, doc).filter(claim => claim.kind === 'drafting-floors')
    assert.ok(claims.length > 0, doc + ' prints the drafting thresholds, so the parser must see them as claims')
    for (const claim of claims) {
      assert.equal(claimDrift(claim, floors), undefined, doc + ':' + String(claim.line)
        + ' quotes the thresholds; they must equal the constants the detector uses')
    }
    console.log('# ' + doc + ': ' + String(claims.length) + ' threshold claim(s), all equal to '
      + String(floors.writingFloor) + ' / ' + String(floors.draftingFloor))
  }

  // THE MUTATION, one document at a time, four for four: nudging the quoted writing count by one
  // must fail in every one of them and name the file and both numbers. This is the gate's proof
  // inverted - it nudged 39 -> 38 and the suite stayed green.
  const failures = []
  for (const { doc, text, claim } of quoting) {
    const doctored = doctorQuotedNumber(text, doc, 'verb-margin', 'academic-pipeline',
      claim.writingVerbs, claim.writingVerbs - 1)
    const after = quotedClaims(doctored.text, doc).find(found => found.kind === 'verb-margin')
    assert.ok(after !== undefined, 'the doctored copy of ' + doc + ' must still yield the claim')
    assert.equal(after.writingVerbs, claim.writingVerbs - 1,
      'the nudge did not take effect in ' + doc + ': the claim reads ' + String(after.writingVerbs))
    const drift = claimDrift(after, measured)
    assert.ok(drift !== undefined, doc + ': a one-verb nudge must FAIL, and this one passed - the pin does not bite')
    assert.match(drift, new RegExp(literal(doc) + ':' + String(after.line), 'u'),
      'the failure must name the document and line: ' + drift)
    assert.match(drift, new RegExp(String(claim.writingVerbs - 1) + '/' + String(claim.draftingVerbs), 'u'),
      'the failure must name the number the document quotes: ' + drift)
    assert.match(drift, new RegExp(String(measured.writingVerbs) + '/' + String(measured.draftingVerbs), 'u'),
      'the failure must name the number the code measures: ' + drift)
    failures.push(doc)
    console.log('# mutation: ' + doc + ' ' + String(claim.writingVerbs) + ' -> ' + String(claim.writingVerbs - 1)
      + ' fails with: ' + drift)
  }
  assert.deepEqual(failures.sort(), [...PIPELINE_VERB_DOCS].sort(), 'four for four: every document must fail when nudged')

  // ...and the thresholds bite too: one nudge of the floor, in each document that prints it.
  for (const doc of FLOOR_DOCS) {
    const text = await readFile(join(repoRoot, doc), 'utf8')
    const doctored = doctorQuotedNumber(text, doc, 'drafting-floors', null,
      floors.writingFloor, floors.writingFloor + 1)
    const after = quotedClaims(doctored.text, doc).find(found => found.kind === 'drafting-floors')
    assert.ok(after !== undefined, 'the doctored copy of ' + doc + ' must still yield a threshold claim')
    assert.equal(after.writingFloor, floors.writingFloor + 1, 'the floor nudge did not take effect in ' + doc)
    const drift = claimDrift(after, floors)
    assert.ok(drift !== undefined, doc + ': a floor nudged by one must fail, and this one passed')
    assert.match(drift, /FILE_PRODUCING_MIN_WRITING_VERBS/u, 'the failure must name the constant: ' + drift)
    console.log('# mutation: ' + doc + ' floor ' + String(floors.writingFloor) + ' -> '
      + String(floors.writingFloor + 1) + ' fails with: ' + drift)
  }
})
