/**
 * Skill provider for the vendored academic-paper-reviewer skill.
 *
 * The upstream skill is a prompt-only protocol (SKILL.md plus agents,
 * references, templates, and examples). This provider advertises the vendored
 * copy through ctx.skills.registerProvider and loads the body on demand from
 * the vendor directory, so the model sees the upstream text verbatim while the
 * plugin layer owns state, tools, and checkpoints.
 *
 * Nothing here writes to vendor/: the provider is read-only and the vendored
 * tree stays byte-identical to upstream (docs/PORT_SPEC.md section 1.2).
 *
 * @module dsh-academic-review/skills
 */
import type { Context } from '@deepseek-ai/cordis';
import type { SkillCandidate, SkillDefinition, SkillProvider, SkillProviderControl, SkillResourceBase } from '@deepseek-ai/dsh-skill';
/** Public skill name addressed by the model (upstream name, unchanged). */
export declare const REVIEW_SKILL_NAME = "academic-paper-reviewer";
/** Precedence rank: below project skills (100/200) and above user skills (400+). */
export declare const REVIEW_SKILL_RANK = 450;
/** Instruction file inside the vendored skill directory. */
export declare const SKILL_INSTRUCTION_FILE = "SKILL.md";
/** Discovery source bucket reported for the vendored skill. */
export declare const REVIEW_SKILL_SOURCE = "bundled";
/** Provider configuration resolved by the plugin. */
export interface ReviewSkillProviderConfig {
    /** Provider name registered on ctx.skills. */
    readonly providerName: string;
    /** Absolute directory of the vendored skill (vendor/academic-paper-reviewer). */
    readonly resourceBasePath: string;
    /** Skill name to advertise; defaults to REVIEW_SKILL_NAME. */
    readonly skillName?: string;
    /** Precedence rank; defaults to REVIEW_SKILL_RANK. */
    readonly rank?: number;
}
/**
 * The plugin package root resolved from this module's own URL (lib/skills.js).
 * @returns absolute package root directory.
 */
export declare function packageRoot(): string;
/**
 * Default vendored skill directory: <package root>/vendor/academic-paper-reviewer.
 * @returns absolute directory path.
 */
export declare function defaultResourceBasePath(): string;
/** Parsed SKILL.md frontmatter and body. */
interface SkillDocument {
    readonly name?: string;
    readonly description?: string;
    readonly body: string;
}
/**
 * Split a Markdown skill file into its YAML frontmatter fields and body.
 * The parser is deliberately minimal: the vendored frontmatter is a flat map
 * of scalars, and the body is passed through byte-for-byte.
 * @param text - raw file content.
 * @returns parsed frontmatter fields plus the body.
 */
export declare function parseSkillDocument(text: string): SkillDocument;
/** Read-only skill provider over one vendored skill directory. */
export declare class VendoredReviewSkillProvider implements SkillProvider {
    /** Provider name used by the skill registry. */
    readonly name: string;
    /** Absolute vendored skill directory. */
    readonly resourceBasePath: string;
    /** Advertised skill name. */
    readonly skillName: string;
    /** Precedence rank. */
    readonly rank: number;
    /** Registration lifecycle, borrowed from the registry. */
    private readonly control;
    constructor(config: ReviewSkillProviderConfig, control: SkillProviderControl);
    /** Absolute path of the vendored instruction file. */
    get instructionPath(): string;
    /** Resource base advertised to the model for relative references. */
    get resourceBase(): SkillResourceBase;
    /**
     * List the vendored skill.
     * A missing instruction file is a hard discovery failure rather than a silent
     * empty catalog, so a broken install is visible instead of invisible.
     * @param options - lookup options; the signal cancels discovery.
     * @returns one candidate.
     */
    list(options?: {
        signal?: AbortSignal | undefined;
    }): Promise<readonly SkillCandidate[]>;
    /**
     * Load the vendored skill body.
     * @param candidate - candidate previously returned by this provider.
     * @param options - lookup options; the signal cancels the read.
     * @returns the complete skill definition, or undefined if the file vanished.
     */
    get(candidate: SkillCandidate, options?: {
        signal?: AbortSignal | undefined;
    }): Promise<SkillDefinition | undefined>;
}
/**
 * Register the vendored reviewer skill provider on ctx.skills.
 * @param ctx - plugin context (injects skills).
 * @param config - resolved provider configuration.
 * @returns the disposer that unregisters the provider.
 */
export declare function registerReviewSkillProvider(ctx: Context, config: ReviewSkillProviderConfig): () => void;
export {};
