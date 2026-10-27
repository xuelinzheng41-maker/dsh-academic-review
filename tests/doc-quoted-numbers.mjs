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
 * Three kinds of claim are read:
 * - file-production: writing/drafting verb counts for a named skill;
 * - repository-bytes: the on-disk size of a skill's SKILL.md;
 * - shared-scope: distinct missing shared/ targets and the number of sites naming them.
 *
 * What this module does NOT do: pin a changelog. A release entry records something
 * that already happened, so it stays true across a re-vendor; pinning it would turn a
 * true sentence red and push someone to edit a record.
 *
 * @module dsh-academic-review/tests/doc-quoted-numbers
 */

/** Skill names as they appear in prose, longest first so academic-paper-reviewer wins. */
const SKILL_TOKENS = [
  { token: 'academic-paper-reviewer', skill: 'academic-paper-reviewer' },
  { token: 'academic-paper', skill: 'academic-paper' },
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
]

/** The claim kinds this module understands. */
export const CLAIM_KINDS = ['file-production', 'repository-bytes', 'shared-scope']

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
export function quotedClaims(text, docName) {
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
      definition.fields.forEach((field, offset) => {
        claim[field] = field === 'bytes' ? toCount(match[offset + 1]) : Number(match[offset + 1])
      })
      if (definition.kind !== 'shared-scope') {
        const skill = skillOfClaim(text, match.index)
        if (skill === undefined) continue
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
  'repository-bytes': (claim) => 'the vendored vendor/' + claim.skill + '/SKILL.md',
  'shared-scope': () => 'missingReferencesByScope()',
}

/** What was measured, rendered for a failure message. */
function rendered(kind, measured) {
  if (kind === 'file-production') return String(measured.writingVerbs) + '/' + String(measured.draftingVerbs) + ' (writing/drafting)'
  if (kind === 'repository-bytes') return String(measured.bytes) + ' repository bytes'
  return String(measured.distinct) + ' distinct references over ' + String(measured.sites) + ' reference sites'
}

/** What the document said, rendered for a failure message. */
function quoted(claim) {
  if (claim.kind === 'file-production') return String(claim.writingVerbs) + '/' + String(claim.draftingVerbs) + ' (writing/drafting)'
  if (claim.kind === 'repository-bytes') return String(claim.bytes) + ' repository bytes'
  return String(claim.distinct) + ' distinct references over ' + String(claim.sites) + ' reference sites'
}

/** Whether a claim and a measurement agree, per claim kind. */
function agrees(claim, measured) {
  if (claim.kind === 'file-production') return claim.writingVerbs === measured.writingVerbs && claim.draftingVerbs === measured.draftingVerbs
  if (claim.kind === 'repository-bytes') return claim.bytes === measured.bytes
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
    : claim.kind === 'repository-bytes' ? 'SKILL.md of ' + claim.skill : claim.skill
  return where + ' says ' + subject + ' is ' + quoted(claim)
    + ', but ' + MEASUREMENT_OF[claim.kind](claim) + ' measures ' + rendered(claim.kind, measured)
    + ' - update the document to the measured numbers, in every language'
}
