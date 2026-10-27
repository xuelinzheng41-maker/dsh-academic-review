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
 * Calibrated against the three vendored skills as measured on 2026-10-27
 * (writing verbs / drafting verbs, on the parsed body):
 *   academic-paper          84 / 53   <- produces files
 *   academic-paper-reviewer 24 /  4   <- reviews, does not write
 *   deep-research           18 /  4   <- researches, does not write
 * Both thresholds sit in the wide gap (3.5x and 13x margins) instead of on a
 * knife edge, and BOTH must hold: a skill that merely says "write" a lot while
 * reviewing, or that says "draft" while describing someone else's draft, does
 * not qualify. A skill that produces files with other vocabulary would be
 * missed by the rule - which is why the table is explicit and reviewed by a
 * human, not generated.
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
        reason: 'Its SKILL.md instructs the model to write and draft .md manuscripts into the workspace '
            + '(84 writing verbs, 53 drafting verbs, 57 ".md" mentions), so policy A must be read before those instructions.',
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
