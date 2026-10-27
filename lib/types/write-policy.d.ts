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
 * at the one moment it matters - as the first thing in EVERY served body - and
 * mirror it in metadata (`writePolicy`, `writePolicyEnforced: false`, and the
 * `writePolicyBasis` where an instrument measured one) so a caller can inspect
 * it without parsing prose. The guarantee is an instruction the model is told to
 * follow, not a constraint the runtime applies.
 *
 * We also ship the skills' scripts verbatim and never execute or audit them:
 * nothing here runs a vendored program, and a served body is text.
 *
 * WHY EVERY SKILL, NOT JUST THE SKILLS WE CAN SHOW PRODUCE FILES
 *
 * The earlier design served this block only to skills that a detector proved
 * produce files, and refused it to everything else. That was the wrong default,
 * because it asked us to prove a negative about a prompt, and we cannot. The
 * qa-gate adversarial pass found three shapes that all write and all scored as
 * non-producers: a skill that writes with shell commands it does not ship
 * (`mkdir -p exports && ls > out/inventory.md` - no interpreter, nothing
 * resolving inside its own directory), a skill that writes through inline
 * `python -c` (no .py token on the line), and prose that says "generate the
 * deliverable" or "produce the artefact" (neither verb is in
 * {@link WRITING_VERB}, so it scored nothing). Each of those shipped with no
 * policy at all.
 *
 * Worse, the both-directions table test could not see that: when the detector
 * misses a skill, the detector and the table agree that it does not produce
 * files, so the test passes. It enforces consistency with the rule, never
 * correctness of the rule, and it is blind to a shared blind spot.
 *
 * The two failure directions are not symmetric. A block served to a skill that
 * never writes costs a few lines of harmless instruction - qa-gate measured
 * that such a skill suffers nothing. A file-producing skill served without the
 * block loses the policy entirely, at exactly the moment it writes. So the
 * serving rule is now UNCONDITIONAL: every served skill gets the block, and the
 * rule cannot be fooled by a write shape nobody thought to enumerate.
 *
 * Why the rule has to be PREPENDED: every served body spends its text telling
 * the model what to draft, or which command to run. A rule read after those
 * instructions is a rule read after the decision to write has already been made,
 * so the block goes first.
 *
 * WHAT THE DETECTOR AND THE TABLE ARE NOW: DOCUMENTATION, NOT A GATE
 *
 * The detector below survives because it answers a question worth answering -
 * which vendored skills are DEMONSTRATED file producers, and by which
 * instrument - and a reader deserves that answer next to the rule. It decides
 * nothing about serving: no skill is denied the block for being absent from the
 * table, and {@link renderWritePolicyBlock} does not consult it. Two instruments
 * are measured, because reality has two shapes:
 *
 * 1. PROSE DRAFTING ({@link draftsDocuments}): writing verbs at or above
 *    {@link FILE_PRODUCING_MIN_WRITING_VERBS} AND drafting verbs at or above
 *    {@link FILE_PRODUCING_MIN_DRAFTING_VERBS}. Both must hold; see the note on
 *    the thresholds below.
 * 2. BUNDLED SCRIPT EXECUTION ({@link runsBundledScripts}): a command line that
 *    (a) starts with an interpreter, (b) names an executable file this package
 *    actually ships inside THAT SKILL'S OWN directory, and (c) carries an
 *    argument through which the program is told to write something. All three on
 *    the same line, and (b) is checked against the disk, not against the text.
 *
 * What the detector records, and what it is known to miss:
 * - ACADEMIC-PAPER-REVIEWER is a demonstration of the limit, not a licence to
 *   skip the block. It instructs `python3 scripts/audit_panel_claims.py ...
 *   --out-dir ...`, which fails (b) because the executable must resolve inside
 *   the skill's own vendored directory: audit_panel_claims.py lives upstream at
 *   the REPOSITORY ROOT (beside scripts/test_audit_panel_claims.py), the
 *   reviewer's own tree ships no .py file at all, and this port vendors no root
 *   scripts/ tree. Same interpreter, same kind of output argument as
 *   sr-screener's `python $S/build_outputs.py --work sr_work --out Screening_TA
 *   --config screening_config.json`, opposite verdict, decided purely by where
 *   the executable lives. It carries the block anyway.
 * - The three qa-gate shapes above are recorded as UNPROVEN, not as
 *   non-producers. Absence from this table means "we could not show it writes",
 *   never "it does not write".
 * - ACADEMIC-PIPELINE is the case that keeps this honest as documentation: an
 *   orchestrator that dispatches the drafting and reviewing skills, it lands just
 *   under both thresholds and ships no executable of its own - its integrity stages
 *   name upstream root scripts this port deliberately does not vendor - so no
 *   instrument demonstrates it and the record leaves it out. That verdict is close
 *   enough to the line to be worth stating plainly, and it changes nothing that
 *   matters: the block is attached to every skill, so a verdict a reader might argue
 *   with cannot cost a producer its policy. The threshold is not tuned to make the
 *   answer tidier in either direction; the measurement is reported by the suite on
 *   every run.
 *
 * THE TABLE IS STILL CHECKED IN BOTH DIRECTIONS, AND STILL CANNOT PROVE THE RULE
 *
 * tests/write-policy.test.mjs fails when a vendored skill the detector calls a
 * producer is missing from the table, and when the table lists a skill the
 * detector no longer calls a producer - so the documentation cannot rot in either
 * direction. That test is worth keeping precisely because it is weak: it proves
 * the record matches the detector, and the adversarial fixtures in the same suite
 * demonstrate why the detector cannot be trusted with the serving decision.
 * * @module dsh-academic-review/write-policy
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
/** One skill demonstrated to produce files, and how that was demonstrated. */
export interface FileProducingSkill {
    /** Vendored skill directory name. */
    readonly skill: string;
    /** Which of the two instruments measured it. */
    readonly basis: FileProductionBasis;
    /** One-line justification, for the reader of this file and test failures. */
    readonly reason: string;
}
/**
 * The vendored skills DEMONSTRATED to produce files, and the instrument that
 * demonstrated it. This is documentation, not a precondition: every served skill
 * carries policy A whether or not it appears here, and nothing in the serving path
 * consults this list. A skill absent from it is unproven, not proven harmless.
 * Keep it in sync with {@link qualifyFileProduction}: tests/write-policy.test.mjs
 * fails in both directions if it drifts, and listens to what that test can and
 * cannot prove (see the module header).
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
 *
 * The two instruments are deliberately different in kind, and the script one turns
 * on LOCATION: the executable a line names must resolve inside that skill's own
 * vendored directory. The cleanest proof that this is a location rule is the pair
 * of lines it separates - sr-screener qualifies with
 * `python $S/build_outputs.py --work sr_work --out Screening_TA --config
 * screening_config.json`, while academic-paper-reviewer does not with
 * `python3 scripts/audit_panel_claims.py ... --out-dir ...`: same interpreter,
 * same kind of output argument, opposite verdict, decided only by whether the
 * executable lives where the skill can ship it. (audit_panel_claims.py exists
 * upstream at the repository root, not inside the reviewer's directory, which
 * ships no .py file at all; this port vendors neither the root script nor a
 * reading of it. The rule needs no root-script logic to refuse it.)
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
 * The table entry for one skill, if it is a demonstrated producer.
 * This is a lookup in the record, not a serving decision: a skill with no entry
 * still receives the block.
 * @param skillName - served skill name.
 * @returns the entry, or undefined when no instrument demonstrated production.
 */
export declare function fileProducingEntry(skillName: string): FileProducingSkill | undefined;
/**
 * Render the block prepended to EVERY served skill body.
 *
 * Unconditional by design, and the signature says so: there is no skill argument to
 * condition on, because conditioning on one is what produced the false negatives
 * the module header describes. The block is cheap; a producer served without it is
 * not. A caller that used to pass a skill name can drop the argument.
 *
 * One block for every shape. It speaks of files, artefacts and steps rather than
 * drafts, so it is true for a skill that drafts prose (academic-paper), one that
 * produces files by running bundled scripts (sr-screener), and one that does not
 * write at all (academic-paper-reviewer) - and it names the script shape explicitly
 * instead of leaving the model to reinterpret "artefact" per command: for the step
 * "run build_outputs.py --out Screening_TA", the risk is not whether an output is an
 * artefact but WHICH paths the command writes, so the bullet names its --out target,
 * work dir, log and workbook. One block, never one per shape or per skill.
 *
 * tests/write-policy.test.mjs asserts the property, not the prose: the block must
 * keep the cannot-be-enforced sentence, must keep the bundled-script sentence (with
 * a mutation proving the check fails when it is removed), must not acquire
 * drafting-only vocabulary, and must be served to every vendored skill including
 * the ones no instrument can prove write.
 * @returns the block (with a trailing blank line).
 */
export declare function renderWritePolicyBlock(): string;
/**
 * Metadata a served skill advertises about policy A.
 *
 * PUBLIC SURFACE, AND WE ARE PROMISING IT STAYS. These keys are how a caller -
 * a panel, a report, a docs table - inspects the policy without parsing the served
 * prose, so they are part of the plugin's contract to the host, not an internal
 * detail.
 *
 * THE ASYMMETRY BETWEEN THE KEYS IS DELIBERATE, SO DO NOT "FIX" IT:
 *
 * - `writePolicy: 'new-paths-only'` and `writePolicyEnforced: false` are on EVERY
 *   served skill, because the block is served to every skill. `writePolicyEnforced:
 *   false` is deliberate and permanent: it is the machine-readable version of the
 *   honesty boundary at the top of this module, so a consumer cannot read the policy
 *   name and believe the runtime stops overwrites.
 * - `writePolicyBasis: 'prose-drafting' | 'bundled-script'` is on the skills an
 *   instrument actually measured (academic-paper, sr-screener) and is ABSENT on
 *   academic-paper-reviewer and deep-research. A basis for a skill nothing measured
 *   would be a claim with no measurement behind it. Its absence means "we could not
 *   show it writes", never "it does not write" - which is exactly why it does not
 *   gate the block.
 *
 * The basis is read off the {@link FILE_PRODUCING_SKILLS} entry, never typed here a
 * second time, so the advertisement cannot drift from the record that measured it.
 * @param skillName - served skill name.
 * @returns the three keys for a file-producing skill, or an empty object otherwise.
 */
export declare function writePolicyMetadataOf(skillName: string): Record<string, unknown>;
