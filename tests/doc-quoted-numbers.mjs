/**
 * Parse the numbers the docs quote, in every language the docs are written in,
 * so a test can compare them with what the code measures instead of trusting them.
 *
 * Three rounds have now been spent on numbers that nobody recomputes: a byte count
 * in a report, a verb count inside src/write-policy.ts, and then the same verb
 * counts quoted in English only, which let README.zh-CN.md drift unnoticed because
 * the parser was monolingual. So this module is language-aware by construction:
 * each language supplies its own word list and its own separator policy, and they
 * are joined onto ONE set of numeric tokens. No sentence is duplicated here - the
 * only numbers in this file are the ones read out of the documents.
 *
 *   English  README.md:81        "... 85 writing verbs and 46 drafting verbs ..."
 *   Chinese  README.zh-CN.md:69  "... 85 \u4e2a\u5199\u4f5c\u52a8\u8bcd\u300146 \u4e2a\u8d77\u8349\u52a8\u8bcd ..."
 *
 * Separator policy, which is the part that cannot be shared: English separates
 * words with whitespace, so a clause needs at least one space (and the docs wrap
 * mid-sentence, so exactly one line break is allowed); Chinese writes words with
 * no separator at all, so spaces are optional and only the line break has to be
 * tolerated. A [ \t]+ rule carried over to Chinese would match nothing and the
 * test would silently pass while a whole document rotted - which is precisely the
 * bug this module now exists to prevent.
 *
 * Five kinds of claim are read:
 * - file-production: writing/drafting verb counts for a named skill;
 * - repository-bytes: the on-disk size of a skill's SKILL.md;
 * - shared-scope: distinct missing shared/ targets and the number of sites naming them;
 * - verb-margin: the same counts written as a margin, "39 writing verbs / 18 drafting verbs";
 * - drafting-floors: the thresholds themselves, "40 and 20" / "writing verbs ≥ 40 ...".
 *
 * What this module does NOT do: pin a changelog. A release entry records something
 * that already happened, so it stays true across a re-vendor; pinning it would turn a
 * true sentence red and push someone to edit a record.
 *
 * @module dsh-academic-skills/tests/doc-quoted-numbers
 */

/** Skill names as they appear in prose, longest first so academic-paper-reviewer wins. */
const SKILL_TOKENS = [
  { token: 'academic-paper-reviewer', skill: 'academic-paper-reviewer' },
  { token: 'academic-paper', skill: 'academic-paper' },
  // The fifth skill, added in 0.5.0 and missing from this table until its counts were
  // quoted: without it a sentence about the pipeline was attributed to whichever skill was
  // named last before it, which is the t35 misattribution waiting to happen in a new
  // paragraph. Longest first is preserved: 'academic-pipeline' is not a prefix of another.
  { token: 'academic-pipeline', skill: 'academic-pipeline' },
  { token: 'deep-research', skill: 'deep-research' },
  { token: 'the reviewer', skill: 'academic-paper-reviewer' },
  // The fourth skill. Without this entry a claim about sr-screener was attributed
  // to whichever skill was named last before it - in practice academic-paper, two
  // paragraphs up - and the pinner then compared sr-screener's numbers with
  // academic-paper's body. Longest first, so 'academic-paper-reviewer' still wins
  // over its own prefix.
  { token: 'sr-screener', skill: 'sr-screener' },
]

/**
 * The numeric tokens every language is built from. Written with String.raw so a
 * regex escape reaches the RegExp constructor as an escape: in a plain string
 * literal '`\d`' silently becomes '`d`', which compiles and matches nothing.
 */
const NUMERIC = {
  /** A count of verbs, references or sites. */
  count: String.raw`(\d{1,4})`,
  /** A byte size, possibly written with thousands separators: 65,335. */
  bytes: String.raw`([\d,]{3,})`,
}

/** How a threshold is written in prose: '≥ 40', 'at or above 40', wrapped or not. */
const COMPARATOR = String.raw`(?:≥|>=|at(?:[ \t]*\n?[ \t]*)or(?:[ \t]*\n?[ \t]*)above)`

/** Whitespace policy per language. See the module note: this is what differs. */
const SEPARATOR = {
  /** At least one space; the docs wrap, so one line break is allowed too. */
  English: String.raw`(?:[ \t]+|[ \t]*\n[ \t]*)`,
  /** Chinese writes words with no separator: spaces optional, one line break tolerated. */
  Chinese: String.raw`(?:[ \t]*\n?[ \t]*)`,
}

/** Join one clause's words with a language's separator policy. */
function clause(language, ...words) {
  return words.join(SEPARATOR[language])
}

/**
 * Punctuation is written tight: "(16" and "\uff0816" have no space before the number.
 * Around punctuation the language separator cannot be used, so this token allows
 * optional spaces and, in English, one line break.
 */
const TIGHT = {
  English: String.raw`[ \t]*(?:\n[ \t]*)?`,
  Chinese: SEPARATOR.Chinese,
}

/**
 * The clauses each language can express, built from the shared NUMERIC tokens and
 * that language's own glue. The recipe is the same in both languages - words joined
 * by the language separator, punctuation written tight - only the words differ.
 * The Chinese ideographic comma (\u3001) and full-width parentheses (\uff08...\uff09)
 * appear in that prose and are not separators.
 */
/**
 * The words that attribute a count to the reference WALK rather than to something else that counts
 * markdown files.
 *
 * "15 Markdown files" is ordinary inventory vocabulary - docs/PORT_SPEC.md's tree table uses it for
 * how a vendored tree is laid out, and the subject there is a tree, not the walk. A clause with an
 * attribution requirement is only a claim when its OWN SENTENCE names the instrument, which is the
 * same rule the skill attribution uses: read the sentence, not the nearest word in the file.
 */
const INSTRUMENT = /\bwalk|\breads?\b|\breading\b|\btravers|\breference[ \t]+check\b/iu

/** The same requirement, in Chinese, for a sentence that names no English instrument. */
const INSTRUMENT_CHINESE = /\bwalk|\breads?\b|\breading\b|\btravers|遍历|读取|扫描|读/iu

const CLAUSES = [
  {
    kind: 'file-production',
    language: 'English',
    pattern: clause('English', NUMERIC.count, 'writing', 'verbs', 'and', NUMERIC.count, 'drafting', 'verbs'),
    fields: ['writingVerbs', 'draftingVerbs'],
  },
  {
    kind: 'file-production',
    language: 'Chinese',
    pattern: clause('Chinese', NUMERIC.count, '\u4e2a\u5199\u4f5c\u52a8\u8bcd', String.raw`\u3001?`, NUMERIC.count, '\u4e2a\u8d77\u8349\u52a8\u8bcd'),
    fields: ['writingVerbs', 'draftingVerbs'],
  },
  {
    kind: 'repository-bytes',
    language: 'English',
    pattern: clause('English', NUMERIC.bytes, 'repository', 'bytes'),
    fields: ['bytes'],
  },
  {
    kind: 'repository-bytes',
    language: 'Chinese',
    pattern: clause('Chinese', '\u4ed3\u5e93\u5b57\u8282\u6570', NUMERIC.bytes),
    fields: ['bytes'],
  },
  {
    kind: 'shared-scope',
    language: 'English',
    // "**11 distinct references** (16\nreference sites)" - bold markers and a
    // wrapped line are both ordinary prose here, and "(16" is written tight.
    pattern: [
      NUMERIC.count,
      'distinct',
      String.raw`references?` + TIGHT.English + String.raw`\*{0,2}` + TIGHT.English + String.raw`\(?` + TIGHT.English + NUMERIC.count,
      'reference',
      String.raw`sites?\)?`,
    ].join(SEPARATOR.English),
    fields: ['distinct', 'sites'],
  },
  {
    kind: 'shared-scope',
    language: 'Chinese',
    // "**11 \u4e2a\u4e0d\u540c**\n\u5f15\u7528\uff0816 \u5904\u5f15\u7528\u4f4d\u7f6e\uff09"
    pattern: [
      NUMERIC.count,
      String.raw`\u4e2a\u4e0d\u540c` + TIGHT.Chinese + String.raw`\*{0,2}`,
      String.raw`\u5f15\u7528` + TIGHT.Chinese + String.raw`\*{0,2}` + TIGHT.Chinese + String.raw`[\uff08(]` + TIGHT.Chinese + NUMERIC.count,
      String.raw`\u5904\u5f15\u7528\u4f4d\u7f6e`,
    ].join(SEPARATOR.Chinese),
    fields: ['distinct', 'sites'],
  },

  // THE PIPELINE'S MARGIN. academic-pipeline carries 39 writing verbs against a floor of 40 and
  // 18 drafting against 20, so it is the one skill whose counts are quoted as a NEAR MISS rather
  // than as a qualification - and every document that says so writes it as
  // "39 writing verbs / 18 drafting verbs". Until this clause existed that shape matched no
  // pattern, so the only number the code deliberately refuses to store was the only number
  // nothing checked, in four documents.
  {
    kind: 'verb-margin',
    language: 'English',
    // 'verbs' on both sides and a slash between them: a claim about where a skill sits relative
    // to a threshold, not the 'and' form above, and the two must not be confused.
    pattern: [
      NUMERIC.count,
      'writing',
      String.raw`verbs?` + TIGHT.English + String.raw`\/` + TIGHT.English + NUMERIC.count,
      'drafting',
      String.raw`verbs?`,
    ].join(SEPARATOR.English),
    fields: ['writingVerbs', 'draftingVerbs'],
  },
  {
    kind: 'verb-margin',
    language: 'Chinese',
    pattern: [
      NUMERIC.count,
      '个写作动词' + TIGHT.Chinese + String.raw`\/` + TIGHT.Chinese + NUMERIC.count,
      '个起草动词',
    ].join(SEPARATOR.Chinese),
    fields: ['writingVerbs', 'draftingVerbs'],
  },
  // THE FLOORS. 40 and 20 are numbers too: where a document prints them they are claims about
  // the constants the detector uses, so a threshold that moves in code must move in prose.
  {
    kind: 'drafting-floors',
    language: 'English',
    // "a near miss on both drafting thresholds (40 and 20)"
    pattern: [
      String.raw`(?:thresholds?|floors?)` + TIGHT.English + String.raw`(?:of[ \t]+)?` + TIGHT.English + String.raw`\(` + TIGHT.English + NUMERIC.count,
      'and',
      NUMERIC.count + TIGHT.English + String.raw`\)`,
    ].join(SEPARATOR.English),
    fields: ['writingFloor', 'draftingFloor'],
  },
  {
    kind: 'drafting-floors',
    language: 'English',
    // "writing verbs ≥ 40 **and** drafting verbs at or above 20" - the instrument defined in
    // prose, which is the same two constants stated as a rule instead of as a margin.
    pattern: [
      'writing', 'verbs', COMPARATOR, NUMERIC.count,
      String.raw`\*{0,2}and\*{0,2}`,
      'drafting', 'verbs', COMPARATOR, NUMERIC.count,
    ].join(SEPARATOR.English),
    fields: ['writingFloor', 'draftingFloor'],
  },
  {
    kind: 'drafting-floors',
    language: 'Chinese',
    // "对两条起草阈值（40 与 20）都是擦边未过"
    pattern: [
      '阈值' + TIGHT.Chinese + String.raw`[\uff08(]` + TIGHT.Chinese + NUMERIC.count,
      '与',
      NUMERIC.count + TIGHT.Chinese + String.raw`[\uff09)]`,
    ].join(SEPARATOR.Chinese),
    fields: ['writingFloor', 'draftingFloor'],
  },
  {
    kind: 'drafting-floors',
    language: 'Chinese',
    // "写作动词 ≥ 40 **且** 起草动词 ≥ 20"
    pattern: [
      '写作动词', COMPARATOR, NUMERIC.count,
      String.raw`\*{0,2}且\*{0,2}`,
      '起草动词', COMPARATOR, NUMERIC.count,
    ].join(SEPARATOR.Chinese),
    fields: ['writingFloor', 'draftingFloor'],
  },
  // THE PHRASING THE DOCUMENTS USED BEFORE 0.5.0: "39 writing verbs against a floor of 40,
  // 18 drafting against 20". The four documents were reworded to the slash form, and this
  // module first learned only the new shape - but a maintainer who remembers the old sentence
  // will write it again, and a shape the parser cannot read is a number nothing checks. Written
  // out rather than composed from clause() because the floor numbers are matched WITHOUT
  // capturing, so the fields stay the (writing, drafting) pair.
  {
    kind: 'verb-margin',
    language: 'English',
    pattern: String.raw`(\d{1,4})` + SEPARATOR.English + String.raw`writing` + SEPARATOR.English + String.raw`verbs?` + SEPARATOR.English
      + String.raw`against` + SEPARATOR.English + String.raw`(?:a floor of[ \t]+)?\d{1,4},[ \t]*(\d{1,4})` + SEPARATOR.English
      + String.raw`drafting` + SEPARATOR.English + String.raw`(?:verbs?[ \t]+)?against[ \t]+\d{1,4}`,
    fields: ['writingVerbs', 'draftingVerbs'],
  },
  {
    kind: 'drafting-floors',
    language: 'English',
    // The same two constants, stated as margins: "against a floor of 40 ... against 20".
    pattern: String.raw`against[ \t]+(?:a floor of[ \t]+)?(\d{1,4}),[ \t]*\d{1,4}` + SEPARATOR.English
      + String.raw`drafting` + SEPARATOR.English + String.raw`(?:verbs?[ \t]+)?against[ \t]+(\d{1,4})`,
    fields: ['writingFloor', 'draftingFloor'],
  },
  // THE WALK'S OWN FIVE NUMBERS (t70). tests/skill-references.test.mjs prints them on every run:
  // how many markdown files the reference walk read, how many payload files it did not read, how
  // many payload files carry reference-shaped strings, how many such strings there are, and how
  // many of them would dangle. Every guard behind those numbers is a FLOOR (>= 222 files, > 0
  // strings, >= 5 carriers) - deliberately, so the assertions survive the tree growing - which
  // means a figure restated in the prose is checked by nothing at all and goes stale the moment
  // the tree grows, in the direction that claims LESS than exists: the direction nobody notices.
  // These clauses exist to FIND such a figure, not to pin it. See UNPINNABLE_KINDS.
  {
    kind: 'walk-figures',
    language: 'English',
    subject: 'markdown files the walk read',
    pattern: clause('English', NUMERIC.count, 'markdown', 'files?'),
    fields: ['count'],
    attribution: INSTRUMENT,
  },
  {
    kind: 'walk-figures',
    language: 'English',
    subject: 'payload files the walk did not read',
    pattern: clause('English', NUMERIC.count, 'payload', 'files?'),
    fields: ['count'],
    attribution: INSTRUMENT,
  },
  {
    kind: 'walk-figures',
    language: 'English',
    subject: 'reference-shaped strings found in payload files',
    pattern: clause('English', NUMERIC.count, 'reference-shaped', 'strings?'),
    fields: ['count'],
    attribution: INSTRUMENT,
  },
  {
    kind: 'walk-figures',
    language: 'English',
    subject: 'reference-shaped strings that would dangle',
    pattern: clause('English', NUMERIC.count, 'of', 'them', 'would', 'dangle'),
    fields: ['count'],
    attribution: INSTRUMENT,
  },
  {
    kind: 'walk-figures',
    language: 'Chinese',
    subject: 'markdown files the walk read',
    pattern: NUMERIC.count + String.raw`[ \t]*\u4e2a?[ \t\n]*markdown[ \t]*\u6587\u4ef6`,
    fields: ['count'],
    attribution: INSTRUMENT_CHINESE,
  },
  {
    kind: 'walk-figures',
    language: 'Chinese',
    subject: 'payload files the walk did not read',
    pattern: NUMERIC.count + String.raw`[ \t]*\u4e2a?[ \t\n]*\u8f7d\u8377\u6587\u4ef6`,
    fields: ['count'],
    attribution: INSTRUMENT_CHINESE,
  },
]

/**
 * CLAIMS THAT MUST NOT BE PINNED, ONLY KEPT OUT OF PROSE.
 *
 * The walk's five numbers are the one family in this file whose measurement a document cannot be
 * compared with: the numbers are floors in the walk test, and the walk's own arithmetic lives in
 * that test file rather than in a module, so comparing prose against it would mean a second copy
 * of the walk inside this net - the defect this suite keeps re-learning. Rather than pin a figure
 * that no reader can verify, the team retired the figures from the prose and pointed the sentences
 * at the printed line; this list makes that retirement an assertion. A claim of an unpinnable kind
 * is a failure wherever it appears (page or data exemption aside), so the numbers cannot come back
 * quietly, not even with the value that happens to be right today.

/** The claim kinds this module understands. */
export const CLAIM_KINDS = ['file-production', 'repository-bytes', 'shared-scope', 'verb-margin', 'drafting-floors', 'walk-figures']

/**
 * Kinds whose numbers may not appear in prose at all, because no measurement a document could be
 * compared with exists to pin them to.
 *
 * The reference walk's five counts are guaranteed by floors (>= 222 markdown files, > 0
 * reference-shaped strings, >= 5 carrier files) so that the assertions survive the tree growing.
 * A floor is the right assertion and the wrong number to quote: the prose figure is checked by
 * nothing and drifts the moment a file is added - and it drifts LOW, claiming less coverage than
 * the run has, which is the direction nobody investigates. The walk's arithmetic, meanwhile, lives
 * inside tests/skill-references.test.mjs, so comparing prose against it would mean a second copy of
 * the walk inside the number net - the defect this suite keeps re-learning. So the figures were
 * retired from the documents, which now point at the printed line instead, and this set makes that
 * retirement an assertion: a claim of an unpinnable kind fails wherever it appears, with the value
 * that is right today as surely as with one that is wrong. An exemption still has to carry a reason
 * (and dies when it stops covering anything), which is how a page that genuinely needs the numbers
 * - a worked example about the walk - declares it.
 */
export const UNPINNABLE_KINDS = new Set(['walk-figures'])

/** Claims that are about the instrument rather than about one skill, so they name none. */
const NO_SKILL_KINDS = new Set(['shared-scope', 'drafting-floors', 'walk-figures'])

/** The doc line a match starts on, 1-based, for the failure message. */
function lineOf(text, index) {
  let line = 1
  for (let position = 0; position < index; position += 1) if (text[position] === '\n') line += 1
  return line
}

/** Nearest skill name before an index, or undefined if the text names none. */
function skillBefore(text, index) {
  const haystack = text.slice(0, index).toLowerCase()
  let best
  for (const { token, skill } of SKILL_TOKENS) {
    const at = haystack.lastIndexOf(token)
    if (at === -1) continue
    // Strictly greater, so on a tie the earlier (longer) token wins.
    if (best === undefined || at > best.at) best = { at, skill }
  }
  return best?.skill
}

/** Bounds of the sentence around an index: paragraph breaks and terminators end it. */
function sentenceAround(text, index) {
  const BREAK = /[.!?。！？]/u
  let start = index
  while (start > 0 && BREAK.test(text[start - 1]) === false && text.slice(start - 1, start) !== '\n') start -= 1
  // A line break ends a clause but the sentence may continue on the next line, so
  // only a blank line or a terminator followed by space truly ends it.
  let end = index
  while (end < text.length && BREAK.test(text[end]) === false && text.slice(end, end + 2) !== '\n\n') end += 1
  return { start, end }
}

/**
 * The skill a claim belongs to: the one named in the claim's OWN sentence.
 *
 * This is the fix for a misattribution that reached the release gate: the parser
 * used to attribute every claim to the nearest skill name BEFORE it, anywhere in the
 * document, so a sentence about the fourth skill was validated against the third
 * skill's body two paragraphs earlier. A name anywhere in the claim's own sentence
 * now decides the claim - before it or after it - which is what makes "33,843
 * repository bytes for sr-screener" and "sr-screener's SKILL.md is 33,843 repository
 * bytes" both attributable. Only when the sentence names no skill, or names more than
 * one, does the nearest preceding name decide.
 */
function skillOfClaim(text, index) {
  const haystack = text.slice(0, index).toLowerCase()
  const { start, end } = sentenceAround(text, index)
  const sentence = text.slice(start, end).toLowerCase()
  const named = new Set()
  for (const { token, skill } of SKILL_TOKENS) if (sentence.includes(token)) named.add(skill)
  if (named.size === 1) return [...named][0]
  // Several names in one sentence, or none: fall back to the nearest one before the
  // claim, which is the rule that built the corpus so far.
  void haystack
  return skillBefore(text, index)
}

/** Byte sizes are quoted in prose: strip the thousands separators before comparing. */
function toCount(raw) {
  return Number(String(raw).replace(/[,_\s]/gu, ''))
}

/**
 * Every claim a document makes, as
 * { doc, line, kind, language, skill?, ...numbers, quote }.
 *
 * A clause whose sentence names no skill is skipped rather than guessed at, so the
 * docs may add prose about numbers elsewhere without this test inventing an owner.
 */
export function quotedClaims(text, docName, options = {}) {
  const claims = []
  for (const definition of CLAUSES) {
    const regex = new RegExp(definition.pattern, 'giu')
    for (const match of text.matchAll(regex)) {
      const claim = {
        doc: docName,
        line: lineOf(text, match.index),
        kind: definition.kind,
        language: definition.language,
        // 'quote' is collapsed to one line for messages, so it is NOT a substring of
        // the document; 'index' and 'length' are, which is what lets a test doctor a
        // copy of the document and be sure it doctored the claim it found.
        quote: match[0].replace(/\s+/gu, ' '),
        index: match.index,
        length: match[0].length,
      }
      // A clause may require that its own sentence attribute the number to an instrument (see
      // INSTRUMENT). Without that, inventory prose that counts markdown files would read as a claim
      // about the walk, and this net's first duty is not to invent claims.
      if (definition.attribution !== undefined) {
        const sentence = sentenceAround(text, match.index)
        if (definition.attribution.test(text.slice(sentence.start, sentence.end)) === false) continue
      }
      if (definition.subject !== undefined) claim.subject = definition.subject
      definition.fields.forEach((field, offset) => {
        claim[field] = field === 'bytes' ? toCount(match[offset + 1]) : Number(match[offset + 1])
      })
      if (NO_SKILL_KINDS.has(definition.kind) === false) {
        const skill = skillOfClaim(text, match.index)
        // Without a skill the claim cannot be COMPARED, so the pinning tests skip it. The
        // scanner must not: a new document saying "the pipeline measures 39 writing verbs / 18
        // drafting verbs" without naming the skill still quotes a measurement, and skipping it
        // is exactly the hole this file is being extended to close.
        if (skill === undefined && options.keepSkillless !== true) continue
        claim.skill = skill
      }
      claims.push(claim)
    }
  }
  return claims.sort((left, right) => left.line - right.line
    || left.kind.localeCompare(right.kind)
    || (left.skill ?? '').localeCompare(right.skill ?? ''))
}

/** How a measurement is named in a failure message. */
const MEASUREMENT_OF = {
  'file-production': (claim) => 'fileProductionSignals(' + claim.skill + ')',
  'verb-margin': (claim) => 'fileProductionSignals(' + claim.skill + ')',
  'drafting-floors': () => 'FILE_PRODUCING_MIN_WRITING_VERBS / FILE_PRODUCING_MIN_DRAFTING_VERBS',
  'repository-bytes': (claim) => 'the vendored vendor/' + claim.skill + '/SKILL.md',
  'shared-scope': () => 'missingReferencesByScope()',
  // There is deliberately nothing here to compare a document against: the walk's counts are floors,
  // and its arithmetic lives in tests/skill-references.test.mjs, not in a module this net can call.
  // A claim of this kind therefore never agrees - see agrees() - and the message says why.
  'walk-figures': () => 'the reference walk\'s printed line (tests/skill-references.test.mjs), which is not a number a document may hold',
}

/** What was measured, rendered for a failure message. */
function rendered(kind, measured) {
  if (kind === 'file-production') return String(measured.writingVerbs) + '/' + String(measured.draftingVerbs) + ' (writing/drafting)'
  if (kind === 'verb-margin') return String(measured.writingVerbs) + '/' + String(measured.draftingVerbs) + ' (writing/drafting)'
  if (kind === 'drafting-floors') return String(measured.writingFloor) + ' writing / ' + String(measured.draftingFloor) + ' drafting'
  if (kind === 'repository-bytes') return String(measured.bytes) + ' repository bytes'
  if (kind === 'walk-figures') return 'whatever the walk measures on this run'
  return String(measured.distinct) + ' distinct references over ' + String(measured.sites) + ' reference sites'
}

/** What the document said, rendered for a failure message. */
function quoted(claim) {
  if (claim.kind === 'file-production') return String(claim.writingVerbs) + '/' + String(claim.draftingVerbs) + ' (writing/drafting)'
  if (claim.kind === 'verb-margin') return String(claim.writingVerbs) + '/' + String(claim.draftingVerbs) + ' (writing/drafting)'
  if (claim.kind === 'drafting-floors') return String(claim.writingFloor) + ' writing / ' + String(claim.draftingFloor) + ' drafting'
  if (claim.kind === 'repository-bytes') return String(claim.bytes) + ' repository bytes'
  if (claim.kind === 'walk-figures') return String(claim.count) + ' (' + String(claim.subject) + ')'
  return String(claim.distinct) + ' distinct references over ' + String(claim.sites) + ' reference sites'
}

/** Whether a claim and a measurement agree, per claim kind. */
function agrees(claim, measured) {
  if (claim.kind === 'file-production') return claim.writingVerbs === measured.writingVerbs && claim.draftingVerbs === measured.draftingVerbs
  if (claim.kind === 'verb-margin') return claim.writingVerbs === measured.writingVerbs && claim.draftingVerbs === measured.draftingVerbs
  if (claim.kind === 'drafting-floors') return claim.writingFloor === measured.writingFloor && claim.draftingFloor === measured.draftingFloor
  if (claim.kind === 'repository-bytes') return claim.bytes === measured.bytes
  // A figure the suite prints as a floor has no constant to agree with, so it never agrees: the
  // honest answer is "this may not be quoted", not "this happens to be right today".
  if (claim.kind === 'walk-figures') return false
  return claim.distinct === measured.distinct && claim.sites === measured.sites
}

/**
 * The sentence a claim makes, checked against a measurement: undefined when they
 * agree, otherwise the message to show the next person - the doc, the line, the
 * language the parser was reading, what the document says, what the code measures
 * and where to fix it.
 */
export function claimDrift(claim, measured) {
  if (agrees(claim, measured)) return undefined
  const where = claim.doc + ':' + String(claim.line) + ' (' + claim.language + ')'
  const subject = claim.kind === 'shared-scope'
    ? 'the shared/ scope'
    : claim.kind === 'drafting-floors' ? 'the drafting thresholds'
      : claim.kind === 'walk-figures' ? 'the walk\'s count of ' + String(claim.subject)
        : claim.kind === 'repository-bytes' ? 'SKILL.md of ' + claim.skill : claim.skill
  return where + ' says ' + subject + ' is ' + quoted(claim)
    + ', but ' + MEASUREMENT_OF[claim.kind](claim) + ' measures ' + rendered(claim.kind, measured)
    + ' - update the document to the measured numbers, in every language'
}
