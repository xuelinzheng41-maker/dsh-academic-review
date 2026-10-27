/**
 * Write policy A: new paths only.
 *
 * HONESTY BOUNDARY - READ FIRST, AND DO NOT OVERSELL THIS ANYWHERE.
 *
 * This plugin cannot intercept the host's file tools. The model writes files
 * with the host's tool set (and, for a skill that ships them, by running the
 * skill's own bundled scripts), and this plugin never sees any of those calls,
 * so policy A cannot be technically enforced: there is no interlock, no guard
 * rail, no refusal. What this module does is put the rule in front of the model
 * at the one moment it matters - as the first thing in the served body of a
 * skill that produces files - and mirror it in metadata so a caller can inspect
 * it without parsing prose. The guarantee is an instruction the model is told to
 * follow, not a constraint the runtime applies.
 *
 * We also ship the skills' scripts verbatim and never execute or audit them:
 * nothing here runs a vendored program, and a served body is text.
 *
 * Why the rule has to be PREPENDED: the skills in the table below spend their
 * body telling the model what to draft, or which command to run. A rule read
 * after those instructions is a rule read after the decision to write has
 * already been made, so the block goes first.
 *
 * HOW A SKILL QUALIFIES - TWO INSTRUMENTS, BECAUSE REALITY HAS TWO SHAPES
 *
 * Verb counting alone was the wrong instrument. It was built for a skill that
 * drafts prose, and it passed sr-screener - a skill that produces an Excel
 * log, PRISMA counts and a corpus handoff by telling the model to run its own
 * bundled Python - as "not file-producing", because that SKILL.md barely uses
 * the word "draft". So qualification is now the OR of two measured rules, and a
 * skill qualifies when EITHER holds:
 *
 * 1. PROSE DRAFTING ({@link draftsDocuments}): the body instructs drafting
 *    repeatedly - writing verbs at or above {@link FILE_PRODUCING_MIN_WRITING_VERBS}
 *    AND drafting verbs at or above {@link FILE_PRODUCING_MIN_DRAFTING_VERBS}.
 *    Both must hold; see the note on the thresholds below.
 * 2. BUNDLED SCRIPT EXECUTION ({@link runsBundledScripts}): the body contains a
 *    command line that (a) starts with an interpreter, (b) names an executable
 *    file that this package actually ships inside THAT SKILL'S OWN directory,
 *    and (c) carries an argument through which the program is told to write
 *    something. All three on the same line, and (b) is checked against the disk,
 *    not against the text.
 *
 * Why rule 2 cannot be satisfied by a skill that merely mentions python:
 * - mentioning "python" in prose has no interpreter-plus-script invocation, so
 *   (a) and (b) never both hold on one line;
 * - naming a script the skill does not ship fails (b), because existence is
 *   resolved from the vendored tree - this is what keeps academic-paper-reviewer
 *   out, since it instructs python3 scripts/... that this port does not vendor;
 * - running a shipped script with only read-side arguments (--inputs, --config,
 *   --from) fails (c), because an invocation is only file-producing when it is
 *   told where to put an output;
 * - shipping scripts and never telling the model to run them fails (a): a
 *   shipped helper the model is not instructed to execute is not an instruction
 *   to write, so the skill does not qualify. Pinned by tests/write-policy.test.mjs.
 *
 * WHY A TABLE, AND WHY IT IS CHECKED IN BOTH DIRECTIONS
 *
 * The table is explicit so a reader can see exactly which skills carry the
 * policy and why. A rule computed from the skill's own text keeps it honest:
 * tests/write-policy.test.mjs fails when a vendored skill that qualifies is
 * missing from the table, and it also fails when the table lists a skill that
 * does not qualify. So the table cannot rot in either direction - it can only be
 * wrong out loud.
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
 * Writing/drafting verbs for the prose rule. Counted on the vendored body, i.e.
 * on the text the model actually reads (our own prepended block is never
 * measured).
 */
export declare const WRITING_VERB: RegExp;
/** Drafting vocabulary, the signal that the writing is artefact production. */
export declare const DRAFTING_VERB: RegExp;
/**
 * Thresholds for the prose rule ("this skill instructs the model to draft files").
 *
 * Both must hold: writing verbs AND drafting verbs. A skill that merely says
 * "write" a lot while reviewing, or that mentions "draft" while describing
 * somebody else's draft, does not qualify. The thresholds are set to sit in the
 * wide gap between the skills that draft files and the skills that only read
 * them, rather than close to either side, so an upstream wording change does not
 * flip a skill in or out.
 *
 * The measured counts are NOT recorded here on purpose: they are computed by
 * {@link fileProductionSignals} and printed by tests/write-policy.test.mjs on
 * every run. A number typed into a comment is a number that contradicts the code
 * the next time the vendored body changes - which cost this round twice.
 */
export declare const FILE_PRODUCING_MIN_WRITING_VERBS = 40;
/** Minimum drafting-verb mentions for {@link FILE_PRODUCING_MIN_WRITING_VERBS}. */
export declare const FILE_PRODUCING_MIN_DRAFTING_VERBS = 20;
/**
 * Interpreter tokens. A line that carries one of these is asking to execute a
 * program rather than to read or write prose.
 */
export declare const SCRIPT_INTERPRETER: RegExp;
/** Executable file tokens inside such a command line. */
export declare const SCRIPT_FILE: RegExp;
/**
 * Arguments through which a program is told to write something. A read-only
 * invocation (--inputs, --config, --from, --report) is not an instruction to
 * write, which is why the list is an allow-list rather than "any argument".
 */
export declare const WRITE_OUTPUT_ARGUMENT: RegExp;
/** How a skill points at its own directory inside a command: "$S/build_outputs.py". */
export declare const SELF_DIRECTORY_PREFIX: RegExp;
/** Extensions a skill can ship as executable payload. */
export declare const EXECUTABLE_EXTENSION: RegExp;
/** Why a skill produces files. Exactly one is recorded per table entry. */
export type FileProductionBasis = 'prose-drafting' | 'bundled-script';
/** One skill that produces files, therefore carries policy A. */
export interface FileProducingSkill {
    /** Vendored skill directory name. */
    readonly skill: string;
    /** Which of the two instruments justified the entry. */
    readonly basis: FileProductionBasis;
    /** One-line justification, for the reader of this file and test failures. */
    readonly reason: string;
}
/**
 * The skills that produce files, therefore the skills that carry policy A.
 * Keep this in sync with {@link qualifyFileProduction}: tests/write-policy.test.mjs
 * fails in both directions if it drifts.
 */
export declare const FILE_PRODUCING_SKILLS: readonly FileProducingSkill[];
/** Measurement of one skill body against the prose-drafting rule. */
export interface FileProductionSignals {
    /** Writing/drafting verbs found in the body. */
    readonly writingVerbs: number;
    /** Drafting-verb mentions found in the body. */
    readonly draftingVerbs: number;
    /** Whether both thresholds are met. */
    readonly draftsDocuments: boolean;
    /** Human-readable reason for the verdict, for test failure messages. */
    readonly verdict: string;
}
/** Measurement of one skill body against the bundled-script rule. */
export interface ScriptExecutionSignals {
    /** Executable files this skill ships, skill-relative POSIX paths, sorted. */
    readonly packagedScripts: readonly string[];
    /** Invocations naming one of those shipped scripts. */
    readonly packagedInvocations: number;
    /** Shipped scripts invoked with an output argument (distinct, sorted). */
    readonly writingInvocations: readonly string[];
    /** Whether an instruction to run a shipped script that writes was found. */
    readonly writesViaScripts: boolean;
    /** Human-readable reason for the verdict, for test failure messages. */
    readonly verdict: string;
}
/** Full qualification result for one skill, both instruments. */
export interface FileProductionQualification {
    /** Served skill name. */
    readonly skill: string;
    /** Whether the skill produces files by either instrument. */
    readonly qualifies: boolean;
    /** Which instruments fired, empty when it does not qualify. */
    readonly bases: readonly FileProductionBasis[];
    /** The prose-drafting measurement. */
    readonly prose: FileProductionSignals;
    /** The bundled-script measurement. */
    readonly scripts: ScriptExecutionSignals;
    /** One-line summary for test output. */
    readonly verdict: string;
}
/**
 * Count writing and drafting verbs in one skill body.
 * @param body - the vendored body (frontmatter already stripped).
 * @returns the signal counts and the verdict against the thresholds.
 */
export declare function fileProductionSignals(body: string): FileProductionSignals;
/**
 * Whether a body instructs the model to draft documents (rule 1, prose only).
 * @param body - the vendored body (frontmatter already stripped).
 * @returns whether both prose thresholds clear.
 */
export declare function draftsDocuments(body: string): boolean;
/**
 * Every executable file a vendored skill ships, relative to the skill directory.
 * @param skillDirectory - absolute skill directory.
 * @returns sorted skill-relative POSIX paths.
 */
export declare function packagedScriptsOf(skillDirectory: string): string[];
/**
 * Measure whether a body instructs the model to run the skill's own bundled
 * scripts in a way that writes (rule 2).
 * @param body - the vendored body (frontmatter already stripped).
 * @param skillDirectory - absolute skill directory to resolve shipped scripts against.
 * @returns the script signals and their verdict.
 */
export declare function scriptExecutionSignals(body: string, skillDirectory: string): ScriptExecutionSignals;
/**
 * Whether a body instructs the model to run bundled scripts that write (rule 2).
 * @param body - the vendored body (frontmatter already stripped).
 * @param skillDirectory - absolute skill directory.
 * @returns whether at least one shipped script is invoked with an output argument.
 */
export declare function runsBundledScripts(body: string, skillDirectory: string): boolean;
/**
 * Qualify one skill as file-producing under either instrument.
 * @param input.skillName - served skill name, for the verdict line.
 * @param input.body - the vendored body (frontmatter already stripped).
 * @param input.skillDirectory - absolute skill directory.
 * @returns both measurements and the combined verdict.
 */
export declare function qualifyFileProduction(input: {
    skillName: string;
    body: string;
    skillDirectory: string;
}): FileProductionQualification;
/**
 * The table entry for one skill, if it carries policy A.
 * @param skillName - served skill name.
 * @returns the entry, or undefined when the skill does not produce files.
 */
export declare function fileProducingEntry(skillName: string): FileProducingSkill | undefined;
/**
 * Render the block prepended to a file-producing skill's served body.
 * Empty string for any other skill, so its body stays byte-identical.
 *
 * One block, both shapes. It speaks of files, artefacts and steps rather than
 * drafts, so it is true for a skill that drafts prose (academic-paper) and for one
 * that produces files by running bundled scripts (sr-screener) - and it names the
 * script shape explicitly instead of leaving the model to reinterpret "artefact"
 * per command: for the step "run build_outputs.py --out Screening_TA", the risk is
 * not whether an output is an artefact but WHICH paths the command writes, so the
 * bullet names its --out target, work dir, log and workbook. The block stays one
 * block (never one per shape) and its bytes are identical for every skill that
 * carries it.
 *
 * tests/write-policy.test.mjs asserts the property, not the prose: the block must
 * keep the cannot-be-enforced sentence, must require the bundled-script sentence
 * (with a mutation proving the check fails when that sentence is removed), and
 * must not acquire drafting-only vocabulary.
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
