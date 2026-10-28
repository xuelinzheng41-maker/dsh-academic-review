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
import { mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
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

  // EVERY PHRASING THE DOCUMENTS HAVE USED, old and new, must still be read. A shape the parser
  // cannot see is a number nothing checks: the four documents were reworded to the slash form in
  // 0.5.0 (t56), so the sentence they used before it has to keep working for the next maintainer
  // who remembers it (t58). This is the guard against a later edit quietly narrowing a pattern.
  const shapes = [
    ['the slash form, English', 'It carries 39 writing verbs / 18 drafting verbs.', 'verb-margin', { writingVerbs: 39, draftingVerbs: 18 }],
    ['the slash form, Chinese', '它实测有 39 个写作动词 / 18 个起草动词。', 'verb-margin', { writingVerbs: 39, draftingVerbs: 18 }],
    ['the pre-0.5.0 margin form', 'It carries 39 writing verbs against a floor of 40, 18 drafting against 20.', 'verb-margin', { writingVerbs: 39, draftingVerbs: 18 }],
    ['the same floors, as margins', 'It carries 39 writing verbs against a floor of 40, 18 drafting against 20.', 'drafting-floors', { writingFloor: 40, draftingFloor: 20 }],
    ['the parenthetical floors', 'A near miss on both drafting thresholds (40 and 20).', 'drafting-floors', { writingFloor: 40, draftingFloor: 20 }],
    ['the parenthetical floors, no space', 'A near miss on both drafting thresholds(40 and 20).', 'drafting-floors', { writingFloor: 40, draftingFloor: 20 }],
    ['the floors by another name', 'A near miss on both drafting floors (40 and 20).', 'drafting-floors', { writingFloor: 40, draftingFloor: 20 }],
    ['the floors, Chinese', '两者都差一点（阈值（40 与 20））。', 'drafting-floors', { writingFloor: 40, draftingFloor: 20 }],
  ]
  for (const [label, text, kind, numbers] of shapes) {
    const shape = quotedClaims(text, 'x', { keepSkillless: true }).find(entry => entry.kind === kind)
    assert.ok(shape !== undefined, 'the parser must read ' + label + ': ' + text)
    assert.deepEqual(numbersOf(shape), numbers, 'the parser must read the right numbers from ' + label)
  }
  console.log('# shapes read: ' + String(shapes.length) + ' phrasings, old and new')

  // And the split the scanner relies on: a sentence that does not name its skill cannot be
  // COMPARED, so the pinning tests skip it - but it still quotes a number, so the scan keeps it.
  const unnamed = 'The pipeline measures 39 writing verbs / 18 drafting verbs.'
  assert.deepEqual(quotedClaims(unnamed, 'x'), [], 'a skill-less claim cannot be compared, so it is skipped')
  assert.equal(quotedClaims(unnamed, 'x', { keepSkillless: true }).length, 1,
    '...and the scanner must still see it')
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
/* ---------------------------------------------------------------------------------------------
 * THE ABSENCE OF AN UNKNOWN QUOTER (t58).
 *
 * Everything above pins documents that are ON A LIST. The gate showed what that is worth: it
 * appended 'The pipeline measures 39 writing verbs / 18 drafting verbs against floors of 40 and
 * 20.' to docs/COMMANDS.md and the suite stayed green, because a list of four documents is not
 * the repository. The next document to quote a count is unchecked until a human remembers.
 *
 * So the scan below walks every Markdown file a maintainer could edit and asserts that each one
 * quoting a claim is accounted for, in one of four ways, each of which carries its reason into
 * the log:
 *
 *   live      pinned against a live measurement by the tests above;
 *   record    the changelog: HISTORY by default, pinned only inside the section for the version
 *             in package.json. That rule produces the current compromise rather than restating
 *             it: a present-tense sentence about the shipped tree is checked, while
 *             '0.3.0 shipped 65,335 bytes' is a statement about a state that has passed and is
 *             never corrected;
 *   exempt    a page that quotes a count it may not be pinned for, declaring it on the page
 *             (an HTML comment, doc-claim-exemption: reason) or in CLAIM_EXEMPTIONS with a
 *             reason AND the claim kinds it covers. An exemption that no longer covers anything,
 *             or that is asked to cover a kind it did not declare, is a FAILURE;
 *   unpinned  everything else, which fails and says what to do.
 *
 * WHY THERE IS NO "EXACTLY ONE PRESENT-TENSE CLAIM" ASSERTION IN HERE. An earlier version of the
 * proof below asserted that the current release section holds exactly one present-tense record
 * claim, because until 0.5.0 shipped that claim was always the pipeline's '39 writing verbs / 18
 * drafting verbs' sentence. It was a proxy for 'every release quotes the pipeline's counts', and
 * the proxy's premise is false for a legitimate release shape: a release whose whole subject is
 * that nothing served changed quotes no count at all. When 0.5.1 became the current section the
 * count went to 0, and the only way to satisfy the assertion was to make the changelog quote the
 * counts twice - which the four-document test forbids. So the count is PRINTED and never asserted;
 * what is asserted is the property it was standing in for: every present-tense claim in the
 * section for the shipped version is pinned, and zero claims is a pass. The number stays on the
 * pass line on purpose - a guard that has nothing to do must still say so out loud, because a
 * check that goes quiet when its subject is empty is how a guard dies unnoticed.
 *
 * WHAT THIS SCAN DOES NOT SEE, stated so the green line does not imply more than it has: it
 * matches the claim shapes the parser knows (see CLAUSES). A bare "1,806,561 bytes" with no
 * 'repository' in front of it is not one of them, so the documents that quote the unvendored
 * upstream scripts' size in that form are outside this net - see the exemption below for the one
 * document that does spell it 'repository bytes'.
 * ------------------------------------------------------------------------------------------- */

/** Directories the scan does not walk, with the reason each one is not a document to check. */
const SCAN_SKIP = new Map([
  ['vendor', 'upstream text: a number inside a vendored body is not a claim this port makes'],
  ['node_modules', 'dependencies, not our prose'],
  ['dist', 'build output'],
  ['coverage', 'build output'],
  ['.git', 'not a document'],
  ['.agent-teams', 'team state, not published documentation'],
])

/** A document path as the walk spells it, whatever platform joined it. */
function toPosix(path) {
  return path.split(String.fromCharCode(92)).join('/')
}

/** Markdown files under a root, skipping the directories above and any dot-directory. */
async function markdownFiles(root, prefix = '') {
  const entries = await readdir(prefix === '' ? root : join(root, prefix), { withFileTypes: true })
  const found = []
  for (const entry of entries) {
    const relative = prefix === '' ? entry.name : prefix + '/' + entry.name
    if (entry.isDirectory()) {
      if (SCAN_SKIP.has(entry.name) || entry.name.startsWith('.')) continue
      found.push(...await markdownFiles(root, relative))
      continue
    }
    if (/\.mdx?$/iu.test(entry.name)) found.push(relative)
  }
  return found.sort()
}

/** The line range of the changelog section for one release, or undefined if it has none. */
function releaseSection(text, version) {
  const lines = text.split('\n')
  for (let index = 0; index < lines.length; index += 1) {
    const heading = /^##\s*\[?(\d+\.\d+\.\d+)/u.exec(lines[index])
    if (heading === null || heading[1] !== version) continue
    let end = lines.length
    for (let next = index + 1; next < lines.length; next += 1) {
      if (/^##\s/u.test(lines[next])) { end = next + 1; break }
    }
    return { start: index + 1, end }
  }
  return undefined
}

/** Claims the current-release section of the record is allowed to make: they are pinned above. */
const PINNED_RECORD_CLAIMS = [{ kind: 'verb-margin', skill: 'academic-pipeline' }]

/**
 * Exemptions that live in the data rather than on the page. Each carries its file, the claim
 * kinds it covers and a reason; it must keep covering something or it is stale and fails.
 *
 * The single entry today is a real measurement this repository cannot take: the 47 upstream
 * scripts that academic-pipeline's stages call and that this port deliberately does not vendor.
 * Their combined size was read from the upstream clone at vendoring time, which is why the number
 * lives in prose and in no code or data file here (grep for 1806561 finds nothing). Exempting the
 * WHOLE FILE would be the hole - the covers list makes any other claim shape in that document
 * fail, and the entry dies the day the sentence goes.
 */
const CLAIM_EXEMPTIONS = [
  {
    path: 'docs/UPSTREAM_INVENTORY.md',
    covers: ['repository-bytes'],
    reason: 'the 1,806,561 bytes are upstream scripts this port does not vendor: they were'
      + ' measured in the upstream clone when the pipeline tree was vendored, and nothing in this'
      + ' repository can recompute them. If those scripts are ever vendored, replace this'
      + ' exemption with a pin',
  },
]

/** A page may declare its own exemption, with a reason, next to its example. */
const PAGE_EXEMPTION = /<!--\s*doc-claim-exemption:\s*([^>]*?)\s*-->/u

/** A reason shorter than this is not a reason. */
const EXEMPTION_REASON_MIN = 20

/** How a claim reads in a message. */
function claimShape(claim) {
  const numbers = claim.kind === 'drafting-floors'
    ? claim.writingFloor + ' / ' + claim.draftingFloor
    : claim.kind === 'repository-bytes'
      ? claim.bytes + ' bytes'
      : claim.kind === 'shared-scope'
        ? claim.distinct + ' distinct / ' + claim.sites + ' sites'
        : claim.writingVerbs + ' / ' + claim.draftingVerbs
  return claim.kind + ' ' + (claim.skill ?? '(no skill)') + ' ' + numbers
}

/**
 * Walk a root and classify every document that quotes a claim. Pure data in, pure data out, so
 * the proofs below run it against a scratch copy of the documents instead of the originals.
 */
async function scanQuoters(root, { live, record, version, exemptions = CLAIM_EXEMPTIONS, pinnedRecord = PINNED_RECORD_CLAIMS }) {
  const scanned = await markdownFiles(root)
  const quoting = []
  const known = []
  const presentTense = []
  const history = []
  const exempted = []
  const unpinned = []
  const stale = []
  const liveSet = new Set(live.map(toPosix))
  const recordPath = toPosix(record)
  for (const path of scanned) {
    const text = await readFile(join(root, path), 'utf8')
    // Shapes, not attributions: a sentence that quotes the counts without naming the skill is
    // still a sentence this repository has to answer for.
    const claims = quotedClaims(text, path, { keepSkillless: true })
    if (claims.length === 0) continue
    quoting.push({ path, claims })
    const marker = PAGE_EXEMPTION.exec(text)
    if (liveSet.has(path)) {
      if (marker !== null) {
        unpinned.push(path + ' is pinned against a live measurement, so it must not exempt itself'
          + ' (' + JSON.stringify(marker[1]) + ')')
      } else {
        known.push(path + ' (live: every claim is compared by the tests above)')
      }
      continue
    }
    if (path === recordPath) {
      const section = releaseSection(text, version)
      for (const claim of claims) {
        const current = section !== undefined && claim.line >= section.start && claim.line <= section.end
        const pinned = pinnedRecord.find(entry => entry.kind === claim.kind && (entry.skill ?? null) === (claim.skill ?? null))
        if (current === false) {
          history.push(path + ':' + String(claim.line) + ' ' + claimShape(claim)
            + ' is HISTORY: the section for ' + String(version) + ' is lines ' + String(section?.start)
            + '-' + String(section?.end) + ', and a record of a state that has passed is never corrected')
        } else if (pinned === undefined) {
          unpinned.push(path + ':' + String(claim.line) + ' ' + claimShape(claim)
            + ' is PRESENT TENSE, inside the section for ' + String(version) + ', and no test pins it:'
            + ' pin it above, or move the sentence into the release it describes')
        } else {
          const line = path + ':' + String(claim.line) + ' ' + claimShape(claim) + ' (record: PRESENT TENSE, pinned)'
          known.push(line)
          presentTense.push(line)
        }
      }
      continue
    }
    const declared = marker === null ? undefined : { reason: marker[1], covers: undefined, where: 'on the page' }
    const listed = exemptions.find(entry => toPosix(entry.path) === path)
    const exemption = declared ?? (listed === undefined ? undefined : { reason: listed.reason, covers: listed.covers, where: 'in CLAIM_EXEMPTIONS' })
    if (exemption === undefined) {
      unpinned.push(path + ' quotes ' + claims.map(claimShape).join('; ')
        + ' but no test pins it. Either add ' + JSON.stringify(path) + ' to the documents the pinning tests'
        + ' check (LIVE_QUOTERS here, or the record stance if it is a changelog), or take the number out'
        + ' of the prose. If the file quotes a count it may not be pinned for, declare that with a'
        + ' reason - on the page (an HTML comment, doc-claim-exemption: why) or in CLAIM_EXEMPTIONS -'
        + ' naming the claim kinds it covers.')
      continue
    }
    if (String(exemption.reason).trim().length < EXEMPTION_REASON_MIN) {
      unpinned.push(path + ' declares an exemption ' + exemption.where + ' with no usable reason ('
        + JSON.stringify(exemption.reason) + '): an exemption must say why, or it is a hole')
      continue
    }
    // A data exemption must cover the kinds actually present, so exempting a file cannot quietly
    // become exempting whatever is added to it later. A page marker is reviewed with its example,
    // so it covers the page.
    if (exemption.covers !== undefined) {
      const uncovered = claims.filter(claim => exemption.covers.includes(claim.kind) === false)
      if (uncovered.length > 0) {
        unpinned.push(path + ' is exempt in CLAIM_EXEMPTIONS for ' + exemption.covers.join(', ')
          + ' only, but it now quotes ' + uncovered.map(claimShape).join('; ')
          + ' - extend the exemption deliberately, or pin the new claim')
        continue
      }
    }
    exempted.push(path + ' (' + exemption.where + ', covers '
      + (exemption.covers ?? ['every shape on the page']).join(', ') + '): ' + String(exemption.reason).trim())
  }

  // AN EXEMPTION THAT NO LONGER COVERS ANYTHING IS A FAILURE.
  for (const entry of exemptions) {
    if (scanned.includes(toPosix(entry.path)) === false) {
      stale.push('CLAIM_EXEMPTIONS names ' + entry.path + ', which is not a Markdown file this scan walks'
        + ' - remove the entry or fix the path (' + JSON.stringify(entry.reason) + ')')
      continue
    }
    const claims = quoting.find(entryQuote => entryQuote.path === toPosix(entry.path))?.claims ?? []
    const covered = claims.filter(claim => entry.covers === undefined || entry.covers.includes(claim.kind))
    if (covered.length === 0) {
      stale.push('CLAIM_EXEMPTIONS exempts ' + entry.path + ' for ' + (entry.covers ?? ['any kind']).join(', ')
        + ' but that file no longer quotes such a claim - the exemption is stale, so remove it'
        + ' (' + JSON.stringify(entry.reason) + ')')
    }
  }
  for (const path of scanned) {
    const text = await readFile(join(root, path), 'utf8')
    if (PAGE_EXEMPTION.test(text) === false) continue
    if (quoting.some(entry => entry.path === path) === false) {
      stale.push(path + ' declares a page exemption but quotes no claim any more - remove the marker')
    }
  }
  return { scanned, quoting, known, history, presentTense, exempted, unpinned, stale }
}

/** The scan inputs for this repository. */
const QUOTER_SCAN = {
  live: QUOTING_DOCS,
  record: 'CHANGELOG.md',
  version: JSON.parse(await readFile(join(repoRoot, 'package.json'), 'utf8')).version,
}

test('no document outside the known set quotes a measurement', async (t) => {
  const report = await scanQuoters(repoRoot, QUOTER_SCAN)
  for (const line of report.known) t.diagnostic('known   ' + line)
  for (const line of report.history) t.diagnostic('history ' + line)
  for (const line of report.exempted) t.diagnostic('exempt  ' + line)
  assert.deepEqual(report.unpinned, [], 'a document quotes a measurement and nothing pins it:\n  '
    + report.unpinned.join('\n  '))
  assert.deepEqual(report.stale, [], 'an exemption no longer covers anything:\n  ' + report.stale.join('\n  '))
  // THE PROPERTY THE COUNT USED TO STAND IN FOR, asserted directly (see the note above): every
  // present-tense claim in the section for the shipped version is pinned. A claim that is not
  // pinned cannot reach the pass line - the scan puts it in unpinned and the assertion above
  // fires - and this one says the property in its own words so the next reader does not have to
  // infer it. Zero present-tense claims is a PASS: a release that changed nothing served has no
  // count to quote.
  assert.deepEqual(report.unpinned.filter(line => /PRESENT TENSE/u.test(line)), [],
    'every present-tense record claim in the current release section must be pinned')
  console.log('# scanned ' + String(report.scanned.length) + ' Markdown files outside '
    + [...SCAN_SKIP.keys()].join('/') + '; ' + String(report.quoting.length) + ' quote a claim: '
    + report.quoting.map(entry => entry.path + ' (' + String(entry.claims.length) + ')').join(', ')
    + ' - ' + String(report.known.length) + ' pinned, ' + String(report.history.length)
    + ' recorded as history, ' + String(report.exempted.length) + ' exempt with a reason; record stance: '
    + String(report.presentTense.length) + ' present-tense claim(s) in the ' + QUOTER_SCAN.version
    + ' section, ' + String(report.presentTense.length) + ' pinned (0 is a pass - a release that'
    + ' changed nothing served quotes no count)')
})

test('the absence assertion bites: a new quoter fails, a listed one passes, a stale exemption fails', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'dsh-doc-quoters-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  // A scratch copy of the documents themselves (never the originals), so this proof is about the
  // scanner and not about what the repository currently says.
  for (const doc of [...QUOTING_DOCS, QUOTER_SCAN.record]) {
    await mkdir(join(directory, doc, '..'), { recursive: true })
    await writeFile(join(directory, doc), await readFile(join(repoRoot, doc), 'utf8'), 'utf8')
  }
  const NL = String.fromCharCode(10)
  const base = { ...QUOTER_SCAN, exemptions: [] }
  const clean = await scanQuoters(directory, base)
  assert.deepEqual(clean.unpinned, [], 'the scratch copy of the known documents must start clean')
  assert.deepEqual(clean.stale, [])
  t.diagnostic('scratch copy: ' + String(clean.scanned.length) + ' files scanned, '
    + String(clean.quoting.length) + ' quoting, none unpinned, ' + String(clean.history.length) + ' historical')

  // 1. A NEW document quoting the counts - the gate's own sentence.
  const intruder = 'docs/COMMANDS.md'
  await mkdir(join(directory, 'docs'), { recursive: true })
  await writeFile(join(directory, intruder), '# Commands' + NL + NL
    + 'The pipeline measures 39 writing verbs / 18 drafting verbs against floors of 40 and 20.' + NL, 'utf8')
  const withIntruder = await scanQuoters(directory, base)
  assert.equal(withIntruder.unpinned.length, 1, 'a new quoter must fail: ' + JSON.stringify(withIntruder.unpinned))
  assert.match(withIntruder.unpinned[0], /docs\/COMMANDS\.md/u, 'the failure must name the file')
  assert.match(withIntruder.unpinned[0], /no test pins it/u)
  assert.match(withIntruder.unpinned[0], /add|take the number out/u, 'the failure must say what to do')
  console.log('# mutation 1 (new quoter): ' + withIntruder.unpinned[0].split(NL)[0])

  // 2. The same file, on the list: green.
  const listed = await scanQuoters(directory, { ...base, live: [...QUOTING_DOCS, intruder] })
  assert.deepEqual(listed.unpinned, [], 'a listed document must pass: ' + JSON.stringify(listed.unpinned))
  console.log('# mutation 2 (same file, now on the list): 0 unpinned, '
    + String(listed.quoting.length) + ' file(s) quote a claim')

  // 3. A stale exemption: the entry names a document that quotes nothing, and one that is gone.
  await writeFile(join(directory, 'docs', 'NOTES.md'), '# Notes' + NL + NL
    + 'No measurements on this page.' + NL, 'utf8')
  const staleData = await scanQuoters(directory, {
    ...base,
    live: [...QUOTING_DOCS, intruder],
    exemptions: [{ path: 'docs/NOTES.md', covers: ['verb-margin'], reason: 'this page used to quote the counts as an example' }],
  })
  assert.equal(staleData.stale.length, 1, 'a stale exemption must fail: ' + JSON.stringify(staleData.stale))
  assert.match(staleData.stale[0], /docs\/NOTES\.md/u)
  assert.match(staleData.stale[0], /stale|no longer quotes/u)
  const stalePage = await scanQuoters(directory, {
    ...base,
    live: [...QUOTING_DOCS, intruder],
    exemptions: [{ path: 'docs/GONE.md', covers: ['verb-margin'], reason: 'a file that does not exist any more' }],
  })
  assert.equal(stalePage.stale.length, 1, 'an exemption for a missing file must fail too')
  console.log('# mutation 3 (stale exemption): ' + staleData.stale[0])

  // 3b. An exemption covers the kinds it declares and no others: the same exempt file quoting a
  // byte count as well must fail, so 'exempt this file' can never mean 'exempt anything'.
  await writeFile(join(directory, 'docs', 'NOTES.md'), '# Notes' + NL + NL
    + 'It carried 39 writing verbs / 18 drafting verbs once, and its SKILL.md is 33,843'
    + ' repository bytes.' + NL, 'utf8')
  const narrow = await scanQuoters(directory, {
    ...base,
    live: [...QUOTING_DOCS, intruder],
    exemptions: [{ path: 'docs/NOTES.md', covers: ['verb-margin'], reason: 'the counts are quoted here as a worked example only' }],
  })
  assert.equal(narrow.unpinned.length, 1, 'an undeclared claim kind in an exempt file must fail')
  assert.match(narrow.unpinned[0], /repository-bytes/u, 'the failure must name the undeclared kind')
  console.log('# mutation 3b (narrow exemption): ' + narrow.unpinned[0].split(NL)[0])
  await rm(join(directory, 'docs', 'NOTES.md'), { force: true })
  // The intruder was proofs 1-3b's fixture; proofs 4 and 5 start from the known set again.
  await rm(join(directory, intruder), { force: true })

  // 4. An example page may declare its exemption ON THE PAGE, with a reason - and the same page
  //    with a useless reason is refused, so the declaration is not a free pass.
  const checker = 'docs/CHECKER.md'
  const examplePage = '# The doc-claim checker' + NL + NL
    + '<!-- doc-claim-exemption: example numbers for the checker, not a claim about the shipped body -->' + NL + NL
    + "It matches '39 writing verbs / 18 drafting verbs' and reports a drift." + NL
  await writeFile(join(directory, checker), examplePage, 'utf8')
  const onPage = await scanQuoters(directory, base)
  assert.deepEqual(onPage.unpinned, [], 'a page declaring its reason must pass: ' + JSON.stringify(onPage.unpinned))
  assert.equal(onPage.exempted.length, 1, 'the exemption must be counted and printed')
  assert.match(onPage.exempted[0], /not a claim about the shipped body/u)
  await writeFile(join(directory, checker), examplePage.replace(
    'example numbers for the checker, not a claim about the shipped body', 'example'), 'utf8')
  const weakReason = await scanQuoters(directory, base)
  assert.equal(weakReason.unpinned.length, 1, 'an exemption without a reason must fail')
  assert.match(weakReason.unpinned[0], /no usable reason/u)
  await writeFile(join(directory, checker), examplePage, 'utf8')
  console.log('# mutation 4 (page exemption): ' + onPage.exempted[0])

  // 5. THE RECORD STANCE, BOTH SIDES OF IT. The split is a rule - HISTORY unless the claim sits in
  //    the section for the version in package.json - and a rule exercised on one side only is half
  //    a rule. So the fixture demonstrates three cases, and NOT a count of how many present-tense
  //    claims exist: that count is a proxy whose premise is false for a release that changed
  //    nothing served (see the note at the top of this block).
  const changelog = await readFile(join(directory, QUOTER_SCAN.record), 'utf8')
  const releaseLines = changelog.split(NL)
  const headings = releaseLines
    .map((line, index) => ({ line, index }))
    .filter(entry => /^##\s/u.test(entry.line))
  assert.ok(headings.length >= 2, 'the copied changelog must carry more than one release section')
  const current = headings[0]
  assert.match(current.line, new RegExp('\\[' + QUOTER_SCAN.version.replace(/\./gu, '\\.') + '\\]'),
    'the copied changelog must open with the shipped version, or "current section" means nothing: '
    + JSON.stringify(current.line))
  const oldest = headings[headings.length - 1]
  const withClaimAfter = (heading, sentence) => {
    const copy = [...releaseLines]
    copy.splice(heading.index + 1, 0, '', sentence)
    return copy.join(NL)
  }

  // (a) the same numbers inside a release that has passed: history, and a pass.
  await writeFile(join(directory, QUOTER_SCAN.record), withClaimAfter(oldest,
    '- The academic-pipeline body then carried 39 writing verbs / 18 drafting verbs.'), 'utf8')
  const historical = await scanQuoters(directory, base)
  assert.deepEqual(historical.unpinned, [], 'a count inside a release that has passed is history, not a failure: '
    + JSON.stringify(historical.unpinned))
  // The inserted sentence goes into the OLDEST section, so it is the last history entry the scan
  // reports; taking the last one, not the first, is what keeps this line about the fixture.
  const recorded = historical.history.filter(line => /39 \/ 18|verb-margin/u.test(line))
  assert.ok(recorded.length >= 2, 'the added count must join the history the changelog already holds: '
    + JSON.stringify(historical.history))
  const insertedAsHistory = recorded[recorded.length - 1]
  assert.ok(Number(insertedAsHistory.slice(insertedAsHistory.indexOf(':') + 1, insertedAsHistory.indexOf(' '))) > current.index,
    'the reported history entry must be the one inside a later section than the current one: ' + insertedAsHistory)
  console.log('# record stance (a) history: ' + insertedAsHistory.slice(0, 190))

  // (b) the same numbers, with their skill named, inside the CURRENT section: pinned, and a pass.
  await writeFile(join(directory, QUOTER_SCAN.record), withClaimAfter(current,
    '- The academic-pipeline body carries 39 writing verbs / 18 drafting verbs.'), 'utf8')
  const present = await scanQuoters(directory, base)
  assert.deepEqual(present.unpinned, [], 'a pinned present-tense claim must pass: ' + JSON.stringify(present.unpinned))
  assert.equal(present.presentTense.length, 1, 'a present-tense claim in the current section must be pinned '
    + 'and reported as such: ' + JSON.stringify(present.presentTense))
  assert.match(present.presentTense[0], /PRESENT TENSE, pinned/u)
  assert.match(present.presentTense[0], /39 \/ 18/u)
  console.log('# record stance (b) present tense, pinned: ' + present.presentTense[0].slice(0, 190))

  // (c) a claim shape nothing pins, inside the CURRENT section: a failure that names the section and
  //     says it is unpinned. This is the mechanism the removed count assertion was standing next to,
  //     and it is now exercised directly instead of inferred from a total.
  await writeFile(join(directory, QUOTER_SCAN.record), withClaimAfter(current,
    '- The academic-paper SKILL.md is 65,335 repository bytes.'), 'utf8')
  const unpinnedCurrent = await scanQuoters(directory, base)
  assert.equal(unpinnedCurrent.unpinned.length, 1, 'an unpinned present-tense claim must fail: '
    + JSON.stringify(unpinnedCurrent.unpinned))
  assert.match(unpinnedCurrent.unpinned[0], /PRESENT TENSE/u, 'the failure must say which stance fired')
  assert.match(unpinnedCurrent.unpinned[0], new RegExp('inside the section for ' + QUOTER_SCAN.version.replace(/\./gu, '\\.'), 'u'),
    'the failure must say WHICH section it is in')
  assert.match(unpinnedCurrent.unpinned[0], /and no test pins it/u)
  assert.match(unpinnedCurrent.unpinned[0], /repository-bytes/u, 'the failure must name the claim')
  assert.match(unpinnedCurrent.unpinned[0], /pin it above|move the sentence/u, 'and what to do about it')
  console.log('# record stance (c) present tense, unpinned: '
    + unpinnedCurrent.unpinned[0].split(NL)[0].slice(0, 190))
  await writeFile(join(directory, QUOTER_SCAN.record), changelog, 'utf8')
})
