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
export declare const WRITE_POLICY_NEW_PATHS_ONLY = "new-paths-only";
/** Opening marker of the prepended write-policy block; it is not upstream text. */
export declare const WRITE_POLICY_BEGIN = "<!-- dsh-academic-review:write-policy:begin (not upstream text) -->";
/** Closing marker of the prepended write-policy block. */
export declare const WRITE_POLICY_END = "<!-- dsh-academic-review:write-policy:end -->";
/**
 * Writing/drafting verbs. Counted on the vendored body, i.e. on the text the
 * model actually reads (our own prepended block is never measured).
 */
export declare const WRITING_VERB: RegExp;
/** Drafting vocabulary, the signal that the writing is artefact production. */
export declare const DRAFTING_VERB: RegExp;
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
export declare const FILE_PRODUCING_MIN_WRITING_VERBS = 40;
/** Minimum drafting-verb mentions for {@link FILE_PRODUCING_MIN_WRITING_VERBS}. */
export declare const FILE_PRODUCING_MIN_DRAFTING_VERBS = 20;
/** One skill that instructs the model to write files. */
export interface FileProducingSkill {
    /** Vendored skill directory name. */
    readonly skill: string;
    /** One-line justification, shown to nobody but the reader of this file. */
    readonly reason: string;
}
/**
 * The skills that produce files, therefore the skills that carry policy A.
 * Keep this in sync with {@link producesFiles}: tests/write-policy.test.mjs
 * fails in both directions if it drifts.
 */
export declare const FILE_PRODUCING_SKILLS: readonly FileProducingSkill[];
/** Measurement of one skill body against the file-producing rule. */
export interface FileProductionSignals {
    /** Writing/drafting verbs found in the body. */
    readonly writingVerbs: number;
    /** Drafting-verb mentions found in the body. */
    readonly draftingVerbs: number;
    /** Whether both thresholds are met. */
    readonly producesFiles: boolean;
    /** Human-readable reason for the verdict, for test failure messages. */
    readonly verdict: string;
}
/**
 * Count writing and drafting verbs in one served-skill body.
 * @param body - the vendored body (frontmatter already stripped).
 * @returns the signal counts and the verdict against the thresholds.
 */
export declare function fileProductionSignals(body: string): FileProductionSignals;
/**
 * Whether a skill body instructs the model to produce files.
 * @param body - the vendored body (frontmatter already stripped).
 * @returns whether both signals clear their thresholds.
 */
export declare function producesFiles(body: string): boolean;
/**
 * The table entry for one skill, if it carries policy A.
 * @param skillName - served skill name.
 * @returns the entry, or undefined when the skill does not write files.
 */
export declare function fileProducingEntry(skillName: string): FileProducingSkill | undefined;
/**
 * Render the block prepended to a file-producing skill's served body.
 * Empty string for any other skill, so its body stays byte-identical.
 * @param skillName - served skill name.
 * @returns the block (with a trailing blank line), or ''.
 */
export declare function renderWritePolicyBlock(skillName: string): string;
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
export declare function writePolicyMetadataOf(skillName: string): Record<string, unknown>;
