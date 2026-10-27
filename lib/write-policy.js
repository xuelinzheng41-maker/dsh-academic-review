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
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
/** Metadata value advertised for a skill that carries policy A. */
export const WRITE_POLICY_NEW_PATHS_ONLY = 'new-paths-only';
/** Opening marker of the prepended write-policy block; it is not upstream text. */
export const WRITE_POLICY_BEGIN = '<!-- dsh-academic-review:write-policy:begin (not upstream text) -->';
/** Closing marker of the prepended write-policy block. */
export const WRITE_POLICY_END = '<!-- dsh-academic-review:write-policy:end -->';
/**
 * Writing/drafting verbs for the prose rule. Counted on the vendored body, i.e.
 * on the text the model actually reads (our own prepended block is never
 * measured).
 */
export const WRITING_VERB = /\b(?:write|writes|writing|written|rewrite|rewrites|rewriting|draft|drafts|drafted|drafting|save|saves|saved|saving|export|exports|exported|exporting)\b/giu;
/** Drafting vocabulary, the signal that the writing is artefact production. */
export const DRAFTING_VERB = /\bdraft(?:s|ed|ing)?\b/giu;
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
export const FILE_PRODUCING_MIN_WRITING_VERBS = 40;
/** Minimum drafting-verb mentions for {@link FILE_PRODUCING_MIN_WRITING_VERBS}. */
export const FILE_PRODUCING_MIN_DRAFTING_VERBS = 20;
/**
 * Interpreter tokens. A line that carries one of these is asking to execute a
 * program rather than to read or write prose.
 */
export const SCRIPT_INTERPRETER = /\b(?:python3?|node|bash|sh|pwsh|powershell)\b/iu;
/** Executable file tokens inside such a command line. */
export const SCRIPT_FILE = /[A-Za-z0-9_./~$@{}-]+\.(?:py|mjs|cjs|js|sh|ps1)\b/gu;
/**
 * Arguments through which a program is told to write something. A read-only
 * invocation (--inputs, --config, --from, --report) is not an instruction to
 * write, which is why the list is an allow-list rather than "any argument".
 */
export const WRITE_OUTPUT_ARGUMENT = /(?:^|\s)(?:--out|--out-dir|--outdir|--output|--output-dir|--out-file|--outfile|--write|--emit|--save|--dest|--target|-o)(?:\s|=|$)|(?:^|\s)>(?!>)/iu;
/** How a skill points at its own directory inside a command: "$S/build_outputs.py". */
export const SELF_DIRECTORY_PREFIX = /^\$(?:S|SKILL|SKILL_DIR|DIR|SCRIPT_DIR)\//iu;
/** Extensions a skill can ship as executable payload. */
export const EXECUTABLE_EXTENSION = /\.(?:py|mjs|cjs|js|sh|ps1)$/iu;
/**
 * The skills that produce files, therefore the skills that carry policy A.
 * Keep this in sync with {@link qualifyFileProduction}: tests/write-policy.test.mjs
 * fails in both directions if it drifts.
 */
export const FILE_PRODUCING_SKILLS = [
    {
        skill: 'academic-paper',
        basis: 'prose-drafting',
        // Deliberately carries no counts: a measurement typed into a string rots the
        // moment the body or a threshold moves. The numbers are printed by
        // tests/write-policy.test.mjs from the module's own signals, never stored.
        reason: 'It instructs the model to draft and persist .md documents into the workspace, '
            + 'so the drafting instructions come before any rule about where the output may land.',
    },
    {
        skill: 'sr-screener',
        basis: 'bundled-script',
        reason: 'It instructs the model to execute its own shipped Python scripts with an output argument, '
            + 'so screening logs, PRISMA counts, the workbook and the corpus handoff land wherever those commands say.',
    },
];
/**
 * Count writing and drafting verbs in one skill body.
 * @param body - the vendored body (frontmatter already stripped).
 * @returns the signal counts and the verdict against the thresholds.
 */
export function fileProductionSignals(body) {
    const writingVerbs = (body.match(WRITING_VERB) ?? []).length;
    const draftingVerbs = (body.match(DRAFTING_VERB) ?? []).length;
    const enoughWriting = writingVerbs >= FILE_PRODUCING_MIN_WRITING_VERBS;
    const enoughDrafting = draftingVerbs >= FILE_PRODUCING_MIN_DRAFTING_VERBS;
    const draftsDocuments = enoughWriting && enoughDrafting;
    return {
        writingVerbs,
        draftingVerbs,
        draftsDocuments,
        verdict: String(writingVerbs) + ' writing verbs (min ' + String(FILE_PRODUCING_MIN_WRITING_VERBS) + ') / '
            + String(draftingVerbs) + ' drafting verbs (min ' + String(FILE_PRODUCING_MIN_DRAFTING_VERBS) + ') -> '
            + (draftsDocuments ? 'drafts documents' : 'does not draft documents'),
    };
}
/**
 * Whether a body instructs the model to draft documents (rule 1, prose only).
 * @param body - the vendored body (frontmatter already stripped).
 * @returns whether both prose thresholds clear.
 */
export function draftsDocuments(body) {
    return fileProductionSignals(body).draftsDocuments;
}
/**
 * Every executable file a vendored skill ships, relative to the skill directory.
 * @param skillDirectory - absolute skill directory.
 * @returns sorted skill-relative POSIX paths.
 */
export function packagedScriptsOf(skillDirectory) {
    const found = [];
    const walk = (directory, prefix) => {
        let entries;
        try {
            entries = readdirSync(directory, { withFileTypes: true, encoding: 'utf8' });
        }
        catch {
            return;
        }
        for (const entry of entries) {
            const relative = prefix === '' ? entry.name : prefix + '/' + entry.name;
            if (entry.isDirectory())
                walk(join(directory, entry.name), relative);
            else if (EXECUTABLE_EXTENSION.test(entry.name))
                found.push(relative);
        }
    };
    walk(skillDirectory, '');
    return found.sort();
}
/**
 * Measure whether a body instructs the model to run the skill's own bundled
 * scripts in a way that writes (rule 2).
 * @param body - the vendored body (frontmatter already stripped).
 * @param skillDirectory - absolute skill directory to resolve shipped scripts against.
 * @returns the script signals and their verdict.
 */
export function scriptExecutionSignals(body, skillDirectory) {
    const packagedScripts = packagedScriptsOf(skillDirectory);
    const shipped = new Set(packagedScripts);
    const writing = new Set();
    let packagedInvocations = 0;
    for (const line of body.split('\n')) {
        if (!SCRIPT_INTERPRETER.test(line))
            continue;
        for (const token of line.match(SCRIPT_FILE) ?? []) {
            const cleaned = token.replace(SELF_DIRECTORY_PREFIX, '').replace(/^\.\//u, '');
            const resolved = [cleaned, 'scripts/' + cleaned].find(candidate => shipped.has(candidate));
            if (resolved === undefined)
                continue;
            packagedInvocations += 1;
            if (WRITE_OUTPUT_ARGUMENT.test(line))
                writing.add(resolved);
        }
    }
    const writingInvocations = [...writing].sort();
    return {
        packagedScripts,
        packagedInvocations,
        writingInvocations,
        writesViaScripts: writingInvocations.length > 0,
        verdict: String(packagedScripts.length) + ' shipped script(s), '
            + String(packagedInvocations) + ' invocation(s) of them, '
            + String(writingInvocations.length) + ' with an output argument'
            + (writingInvocations.length > 0 ? ': ' + writingInvocations.join(', ') : ''),
    };
}
/**
 * Whether a body instructs the model to run bundled scripts that write (rule 2).
 * @param body - the vendored body (frontmatter already stripped).
 * @param skillDirectory - absolute skill directory.
 * @returns whether at least one shipped script is invoked with an output argument.
 */
export function runsBundledScripts(body, skillDirectory) {
    return scriptExecutionSignals(body, skillDirectory).writesViaScripts;
}
/**
 * Qualify one skill as file-producing under either instrument.
 * @param input.skillName - served skill name, for the verdict line.
 * @param input.body - the vendored body (frontmatter already stripped).
 * @param input.skillDirectory - absolute skill directory.
 * @returns both measurements and the combined verdict.
 */
export function qualifyFileProduction(input) {
    const prose = fileProductionSignals(input.body);
    const scripts = scriptExecutionSignals(input.body, input.skillDirectory);
    const bases = [];
    if (prose.draftsDocuments)
        bases.push('prose-drafting');
    if (scripts.writesViaScripts)
        bases.push('bundled-script');
    return {
        skill: input.skillName,
        qualifies: bases.length > 0,
        bases,
        prose,
        scripts,
        verdict: input.skillName + ': ' + prose.verdict + '; ' + scripts.verdict
            + ' -> ' + (bases.length > 0 ? 'produces files (' + bases.join(' + ') + ')' : 'does not produce files'),
    };
}
/**
 * The table entry for one skill, if it carries policy A.
 * @param skillName - served skill name.
 * @returns the entry, or undefined when the skill does not produce files.
 */
export function fileProducingEntry(skillName) {
    return FILE_PRODUCING_SKILLS.find(entry => entry.skill === skillName);
}
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
export function renderWritePolicyBlock(skillName) {
    if (fileProducingEntry(skillName) === undefined)
        return '';
    return [
        WRITE_POLICY_BEGIN,
        '**Port write policy A - not upstream text.** Follow this rule; the plugin cannot enforce',
        'it, because it never sees your file tools.',
        '- Never overwrite, move, rename or delete an existing file in this port.',
        '- Every artefact you produce goes to a new path.',
        '- Every file a bundled script writes on your behalf (its --out target, work dir,',
        '  log or workbook) counts as an artefact you produce.',
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
