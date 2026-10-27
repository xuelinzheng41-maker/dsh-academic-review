/**
 * Write policy A: new paths only.
 *
 * HONESTY BOUNDARY - READ FIRST, AND DO NOT OVERSELL THIS ANYWHERE.
 *
 * This plugin cannot intercept the host's file tools. The model writes files
 * with the host's tool set, which this plugin never sees, so policy A cannot be
 * technically enforced: there is no interlock, no guard rail, no refusal. What
 * this module does is put the rule in front of the model at the one moment it
 * matters - as the first thing in the served body of a skill that instructs the
 * model to write - and mirror it in metadata so a caller can inspect it without
 * parsing prose. The guarantee is an instruction the model is told to follow,
 * not a constraint the runtime applies. Documentation must say the same thing.
 *
 * Why the rule has to be PREPENDED: the skills in the table below spend their
 * body telling the model what to draft. A rule read after those instructions is
 * a rule read after the decision to write has already been made, so the block
 * goes first, before any drafting vocabulary appears.
 *
 * WHY A TABLE, AND WHY IT IS CHECKED IN BOTH DIRECTIONS
 *
 * The table is explicit so a reader can see exactly which skills carry the
 * policy and why - an implicit "everything gets a block" rule would be noise on
 * skills that never write, and would change bodies that have no business
 * changing. A rule computed from the skill's own text keeps it honest:
 * tests/write-policy.test.mjs fails when a vendored skill that matches
 * {@link producesFiles} is missing from the table, and it also fails when the
 * table lists a skill that does not match. So the table cannot rot in either
 * direction - it can only be wrong out loud.
 *
 * @module dsh-academic-review/write-policy
 */
/** Metadata value advertised for a skill that carries policy A. */
export const WRITE_POLICY_NEW_PATHS_ONLY = 'new-paths-only';
/** Opening marker of the prepended write-policy block; it is not upstream text. */
export const WRITE_POLICY_BEGIN = '<!-- dsh-academic-review:write-policy:begin (not upstream text) -->';
/** Closing marker of the prepended write-policy block. */
export const WRITE_POLICY_END = '<!-- dsh-academic-review:write-policy:end -->';
/**
 * Writing/drafting verbs. Counted on the vendored body, i.e. on the text the
 * model actually reads (our own prepended block is never measured).
 */
export const WRITING_VERB = /\b(?:write|writes|writing|written|rewrite|rewrites|rewriting|draft|drafts|drafted|drafting|save|saves|saved|saving|export|exports|exported|exporting)\b/giu;
/** Drafting vocabulary, the signal that the writing is artefact production. */
export const DRAFTING_VERB = /\bdraft(?:s|ed|ing)?\b/giu;
/**
 * Thresholds for "this skill instructs the model to produce files".
 *
 * Both must hold: writing verbs AND drafting verbs. A skill that merely says
 * "write" a lot while reviewing, or that mentions "draft" while describing
 * somebody else's draft, does not qualify. The thresholds are set to sit in the
 * wide gap between the skills that write files and the skills that only read
 * them, rather than close to either side, so an upstream wording change does not
 * flip a skill in or out.
 *
 * The measured counts are NOT recorded here on purpose: they are computed by
 * {@link fileProductionSignals} and printed by tests/write-policy.test.mjs on
 * every run. A number typed into a comment is a number that contradicts the code
 * the next time the vendored body changes - which has already cost this round
 * once. If the numbers move, the test output is the record, not this paragraph.
 *
 * A skill that produces files with different vocabulary would be missed by the
 * rule - which is why the table is explicit and reviewed by a human, not
 * generated.
 */
export const FILE_PRODUCING_MIN_WRITING_VERBS = 40;
/** Minimum drafting-verb mentions for {@link FILE_PRODUCING_MIN_WRITING_VERBS}. */
export const FILE_PRODUCING_MIN_DRAFTING_VERBS = 20;
/**
 * The skills that produce files, therefore the skills that carry policy A.
 * Keep this in sync with {@link producesFiles}: tests/write-policy.test.mjs
 * fails in both directions if it drifts.
 */
export const FILE_PRODUCING_SKILLS = [
    {
        skill: 'academic-paper',
        // Deliberately carries no counts: a measurement typed into a string rots the
        // moment the body or a threshold moves. What a reader needs here is WHY this
        // skill qualifies - the numbers are printed by tests/write-policy.test.mjs
        // from fileProductionSignals() at run time, and are never stored.
        reason: 'Its SKILL.md instructs the model to draft and persist .md documents into the workspace, '
            + 'so the drafting instructions come before any rule about where the output may land - policy A has to be read first.',
    },
];
/**
 * Count writing and drafting verbs in one served-skill body.
 * @param body - the vendored body (frontmatter already stripped).
 * @returns the signal counts and the verdict against the thresholds.
 */
export function fileProductionSignals(body) {
    const writingVerbs = (body.match(WRITING_VERB) ?? []).length;
    const draftingVerbs = (body.match(DRAFTING_VERB) ?? []).length;
    const enoughWriting = writingVerbs >= FILE_PRODUCING_MIN_WRITING_VERBS;
    const enoughDrafting = draftingVerbs >= FILE_PRODUCING_MIN_DRAFTING_VERBS;
    const producesFiles = enoughWriting && enoughDrafting;
    return {
        writingVerbs,
        draftingVerbs,
        producesFiles,
        verdict: String(writingVerbs) + ' writing verbs (min ' + String(FILE_PRODUCING_MIN_WRITING_VERBS) + ') / '
            + String(draftingVerbs) + ' drafting verbs (min ' + String(FILE_PRODUCING_MIN_DRAFTING_VERBS) + ') -> '
            + (producesFiles ? 'produces files' : 'does not produce files'),
    };
}
/**
 * Whether a skill body instructs the model to produce files.
 * @param body - the vendored body (frontmatter already stripped).
 * @returns whether both signals clear their thresholds.
 */
export function producesFiles(body) {
    return fileProductionSignals(body).producesFiles;
}
/**
 * The table entry for one skill, if it carries policy A.
 * @param skillName - served skill name.
 * @returns the entry, or undefined when the skill does not write files.
 */
export function fileProducingEntry(skillName) {
    return FILE_PRODUCING_SKILLS.find(entry => entry.skill === skillName);
}
/**
 * Render the block prepended to a file-producing skill's served body.
 * Empty string for any other skill, so its body stays byte-identical.
 * @param skillName - served skill name.
 * @returns the block (with a trailing blank line), or ''.
 */
export function renderWritePolicyBlock(skillName) {
    if (fileProducingEntry(skillName) === undefined)
        return '';
    return [
        WRITE_POLICY_BEGIN,
        '**Port write policy A - not upstream text.** Follow this rule; the plugin cannot enforce',
        'it, because it never sees your file tools.',
        '- Never overwrite, move, rename or delete an existing file in this port.',
        '- Every artefact you produce goes to a new path.',
        '- If a step would write to an existing path, choose a new name and tell the user',
        '  the name you used.',
        '- If a step seems to require replacing a file, stop and ask the user instead.',
        WRITE_POLICY_END,
        '',
        '',
    ].join('\n');
}
/**
 * Metadata a served skill advertises about policy A.
 *
 * `writePolicyEnforced: false` is deliberate and permanent: it is the machine-
 * readable version of the honesty boundary at the top of this module, so a UI or
 * a downstream consumer cannot read `writePolicy: 'new-paths-only'` and believe
 * the runtime stops overwrites.
 * @param skillName - served skill name.
 * @returns the two keys for a file-producing skill, or an empty object otherwise.
 */
export function writePolicyMetadataOf(skillName) {
    if (fileProducingEntry(skillName) === undefined)
        return {};
    return { writePolicy: WRITE_POLICY_NEW_PATHS_ONLY, writePolicyEnforced: false };
}
