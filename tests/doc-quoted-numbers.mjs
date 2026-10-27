/**
 * Parse the file-production numbers the docs quote, so a test can compare them
 * with what the code measures instead of trusting them.
 *
 * Two rounds have now been spent on stale numbers in prose (a byte count in a
 * report, then a verb count inside src/write-policy.ts itself). The docs are
 * allowed to quote the measurement - it is useful to a reader - but a quoted
 * number nobody recomputes is a number that rots. This module turns the prose
 * back into data:
 *
 *   README.md          "... 85 writing verbs and 46 drafting verbs in its own body ..."
 *   docs/PORT_SPEC.md  "... 85 writing verbs and 46 drafting verbs in its own body,
 *                       against 24 / 4 for the reviewer and 18 / 4 for `deep-research`"
 *
 * The skill a clause is about comes from the nearest preceding skill name, not
 * from column position, so the docs can be reordered without breaking the test.
 * Nothing here duplicates an expected value: the only numbers in this file are
 * the ones read out of the documents.
 *
 * @module dsh-academic-review/tests/doc-quoted-numbers
 */

/** Skill names as they appear in prose, longest first so academic-paper-reviewer wins. */
const SKILL_TOKENS = [
  { token: 'academic-paper-reviewer', skill: 'academic-paper-reviewer' },
  { token: 'academic-paper', skill: 'academic-paper' },
  { token: 'deep-research', skill: 'deep-research' },
  { token: 'the reviewer', skill: 'academic-paper-reviewer' },
]

/**
 * A clause separator: whitespace, or a single line break. The docs wrap inside a
 * sentence ("85 writing verbs\nand 46 drafting verbs"), so a plain [ \t]+ would
 * quietly stop matching the day someone reflowed the paragraph. One newline is
 * allowed, never a blank line, so a clause cannot be stitched across paragraphs.
 */
const SEP = '(?:[ \t]+|[ \t]*\n[ \t]*)'

/** "85 writing verbs and 46 drafting verbs". */
const WRITING_CLAUSE = new RegExp(
  '(\\d{1,4})' + SEP + 'writing verbs' + SEP + 'and' + SEP + '(\\d{1,4})' + SEP + 'drafting verbs',
  'giu',
)

/** One ratio as the docs write it: '24 / 4', and the docs do wrap between the two numbers. */
const RATIO = '(\\d{1,4})[ \t]*(?:\n[ \t]*)?\\/[ \t]*(\\d{1,4})'

/** "against 24 / 4 for the reviewer and 18 / 4 for deep-research", name optional in backticks. */
const AGAINST_CLAUSE = new RegExp(
  'against' + SEP + RATIO + SEP + 'for' + SEP + '(?:the' + SEP + ')?reviewer' + SEP + 'and' + SEP
    + RATIO + SEP + 'for' + SEP + '`?deep-research`?',
  'giu',
)

/** The doc line a match starts on, 1-based, for the failure message. */
function lineOf(text, index) {
  let line = 1
  for (let position = 0; position < index; position += 1) if (text[position] === '\n') line += 1
  return line
}

/** Nearest skill name before an index, or undefined if the sentence names none. */
function skillBefore(text, index) {
  const haystack = text.slice(0, index).toLowerCase()
  let best
  for (const { token, skill } of SKILL_TOKENS) {
    const at = haystack.lastIndexOf(token)
    if (at === -1) continue
    if (best === undefined || at > best.at) best = { at, skill }
  }
  return best?.skill
}

/**
 * Every claim a document makes about file-production counts, as
 * { doc, line, skill, writingVerbs, draftingVerbs, quote }.
 * A number whose sentence names no skill is skipped rather than guessed at: the
 * docs may add prose about other numbers without this test inventing an owner.
 */
export function quotedClaims(text, docName) {
  const claims = []
  for (const match of text.matchAll(WRITING_CLAUSE)) {
    const skill = skillBefore(text, match.index)
    if (skill === undefined) continue
    claims.push({
      doc: docName,
      line: lineOf(text, match.index),
      skill,
      writingVerbs: Number(match[1]),
      draftingVerbs: Number(match[2]),
      quote: match[0],
    })
  }
  for (const match of text.matchAll(AGAINST_CLAUSE)) {
    claims.push({
      doc: docName,
      line: lineOf(text, match.index),
      skill: 'academic-paper-reviewer',
      writingVerbs: Number(match[1]),
      draftingVerbs: Number(match[2]),
      quote: match[0],
    })
    claims.push({
      doc: docName,
      line: lineOf(text, match.index),
      skill: 'deep-research',
      writingVerbs: Number(match[3]),
      draftingVerbs: Number(match[4]),
      quote: match[0],
    })
  }
  return claims.sort((left, right) => left.line - right.line || left.skill.localeCompare(right.skill))
}

/**
 * The sentence a claim makes, checked against a measurement: undefined when they
 * agree, otherwise the message to show the next person - the doc and line, the
 * numbers it states, the function that measures them, and the numbers it measured,
 * so nobody has to go looking for either side.
 */
export function claimDrift(claim, measured) {
  if (claim.writingVerbs === measured.writingVerbs && claim.draftingVerbs === measured.draftingVerbs) return undefined
  return claim.doc + ':' + String(claim.line) + ' says '
    + String(claim.writingVerbs) + '/' + String(claim.draftingVerbs) + ' (writing/drafting) for '
    + claim.skill + ', but fileProductionSignals(' + claim.skill + ') measures '
    + String(measured.writingVerbs) + '/' + String(measured.draftingVerbs)
    + ' - update the document to the measured numbers (or, if the verb lists and thresholds in '
    + 'src/write-policy.ts are what changed, update every document that quotes this skill)'
}
