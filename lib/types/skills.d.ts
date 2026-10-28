/**
 * Skill provider for the vendored Academic Research Skills trees.
 *
 * Each upstream skill is a prompt-only protocol (SKILL.md plus agents,
 * references, templates, examples). This provider advertises every vendored
 * skill under `vendor/<skill>/SKILL.md` through ctx.skills.registerProvider,
 * gives each one its own absolute resource base, and loads the body on demand
 * so the model sees the upstream text verbatim while the plugin layer owns
 * state, tools, and checkpoints.
 *
 * Served skills today: `academic-paper-reviewer` (backed by the five
 * academic_review_* tools) and `deep-research` (prompt-only: it runs on the
 * host's own web_search/web_fetch and file tools, so this plugin adds no tool
 * for it).
 *
 * Discovery is a directory scan, not a constant: a skill is vendored when
 * `vendor/<name>/SKILL.md` exists, and its advertised metadata (name,
 * description, upstream version, license) is read from that frontmatter at
 * discovery/load time. Only the repository-level pin (commit, license) comes
 * from vendor-manifest.json, because neither SKILL.md declares a license of
 * its own - and the reported `licenseSource` says which of the two answered.
 *
 * A served body that names a file this package does not ship gets a delimited
 * port notice appended (and the full list in metadata), so a prompt-only skill
 * can never silently teach the model to improvise over a missing reference. The
 * notice is runtime text: the vendored files themselves are never edited.
 *
 * Nothing here writes to vendor/: the provider is read-only and the vendored
 * tree stays byte-identical to upstream (docs/PORT_SPEC.md section 1.2).
 *
 * @module dsh-academic-skills/skills
 */
import { type MissingReference, type SkillReferenceScopes } from './references.ts';
import type { Context } from '@deepseek-ai/cordis';
import type { SkillCandidate, SkillDefinition, SkillLookupOptions, SkillProvider, SkillProviderControl, SkillResourceBase } from '@deepseek-ai/dsh-skill';
/** Instruction file inside every vendored skill directory. */
export declare const SKILL_INSTRUCTION_FILE = "SKILL.md";
/** Advertised name of the reviewer skill (upstream name, unchanged). */
export declare const REVIEW_SKILL_NAME = "academic-paper-reviewer";
/** Advertised name of the deep-research skill (upstream name, unchanged). */
export declare const DEEP_RESEARCH_SKILL_NAME = "deep-research";
/** Precedence rank: below project skills (100/200) and above user skills (400+). */
export declare const REVIEW_SKILL_RANK = 450;
/** Discovery source bucket reported for every vendored skill. */
export declare const REVIEW_SKILL_SOURCE = "bundled";
/** Vendored directory that holds files shared between skills, not a skill itself. */
export declare const SHARED_VENDOR_DIRECTORY = "shared";
/** Repository-level pin file written by the vendoring script. */
export declare const VENDOR_MANIFEST_FILE = "vendor-manifest.json";
/** Plugin package root resolved from this module's own URL (lib/skills.js). */
export declare function packageRoot(): string;
/**
 * Default vendor directory: <package root>/vendor.
 * @returns absolute directory path.
 */
export declare function defaultVendorBasePath(): string;
/**
 * Default directory of the reviewer skill: <package root>/vendor/<reviewer>.
 * Kept because it is the resource base every other module and doc cites.
 * @returns absolute directory path.
 */
export declare function defaultResourceBasePath(): string;
/**
 * Absolute directory of one vendored skill.
 * @param vendorBasePath - absolute vendor directory.
 * @param skillName - vendored skill directory name.
 * @returns absolute skill directory path.
 */
export declare function skillResourceBasePath(vendorBasePath: string, skillName: string): string;
/**
 * Every skill vendored under one vendor directory, sorted by name.
 * A directory counts as a skill only when it holds SKILL.md, so the shared/
 * tree is never mistaken for one.
 * @param vendorBasePath - absolute vendor directory.
 * @returns sorted skill directory names (empty when the directory is absent).
 */
export declare function discoverVendoredSkills(vendorBasePath: string): string[];
/** Selection failure raised before the provider can serve anything. */
export declare class UnknownSkillSelectionError extends Error {
    /** Vendored skill names that do exist. */
    readonly available: readonly string[];
    /** Names the configuration asked for. */
    readonly requested: readonly string[];
    constructor(requested: readonly string[], available: readonly string[], vendorBasePath: string);
}
/**
 * Resolve the skill names to serve.
 * @param vendorBasePath - absolute vendor directory.
 * @param requested - configured subset; omitted or empty serves everything.
 * @returns the selected skill names, every one of them verified present.
 */
export declare function resolveSkillSelection(vendorBasePath: string, requested?: readonly string[]): string[];
/** Parsed SKILL.md frontmatter and body. */
export interface SkillDocument {
    /** Advertised skill name from the frontmatter. */
    readonly name?: string;
    /** Routing description from the frontmatter. */
    readonly description?: string;
    /** Top-level frontmatter scalars (name, description, license, ...). */
    readonly fields: Readonly<Record<string, string>>;
    /** Scalars nested one level under the frontmatter's `metadata:` block. */
    readonly metadata: Readonly<Record<string, string>>;
    /** Instruction body, byte-for-byte. */
    readonly body: string;
}
/**
 * Split a Markdown skill file into its YAML frontmatter fields and body.
 * The parser is deliberately minimal: the vendored frontmatter is scalars and
 * one nested `metadata:` map of scalars, and the body is passed through
 * byte-for-byte.
 * @param text - raw file content.
 * @returns parsed frontmatter fields plus the body.
 */
export declare function parseSkillDocument(text: string): SkillDocument;
/** Repository-level pin read from vendor-manifest.json. */
interface VendorManifest {
    /** Vendored upstream commit, when the manifest records one. */
    readonly commit?: string;
    /** Repository licence covering the vendored trees. */
    readonly license?: string;
}
/** Provider configuration resolved by the plugin. */
export interface ReviewSkillProviderConfig {
    /** Provider name registered on ctx.skills. */
    readonly providerName: string;
    /** Absolute vendor directory holding every vendored skill (default <package root>/vendor). */
    readonly vendorBasePath?: string;
    /** Skill subset to serve; defaults to every vendored skill present. */
    readonly skills?: readonly string[];
    /** Precedence rank; defaults to REVIEW_SKILL_RANK. */
    readonly rank?: number;
}
/** Read-only skill provider over N vendored skill directories. */
export declare class VendoredSkillsProvider implements SkillProvider {
    /** Provider name used by the skill registry. */
    readonly name: string;
    /** Absolute vendor directory. */
    readonly vendorBasePath: string;
    /** Skill names this provider serves, in vendored order. */
    readonly skillNames: readonly string[];
    /** Precedence rank. */
    readonly rank: number;
    /** Registration lifecycle, borrowed from the registry. */
    private readonly control;
    /** Per-skill reference-scope cache; the vendored tree is pinned per install. */
    private readonly scopesBySkill;
    /** Lazily read repository pin, undefined when the manifest is unusable. */
    private manifest;
    constructor(config: ReviewSkillProviderConfig, control: SkillProviderControl, skillNames?: readonly string[]);
    /** Absolute skill directory of one served skill. */
    resourceBasePathOf(skillName: string): string;
    /** Absolute instruction file of one served skill. */
    instructionPathOf(skillName: string): string;
    /** Resource base advertised to the model for one served skill. */
    resourceBaseOf(skillName: string): SkillResourceBase;
    /**
     * List every served vendored skill.
     * A missing instruction file is a hard discovery failure rather than a silent
     * empty catalog, so a broken install is visible instead of invisible.
     * @param options - lookup options; the signal cancels discovery.
     * @returns one candidate per served skill.
     */
    list(options?: SkillLookupOptions): Promise<readonly SkillCandidate[]>;
    /**
     * Load one served skill body.
     * @param candidate - candidate previously returned by this provider.
     * @param options - lookup options; the signal cancels the read.
     * @returns the complete skill definition, or undefined if the file vanished.
     */
    get(candidate: SkillCandidate, options?: SkillLookupOptions): Promise<SkillDefinition | undefined>;
    /**
     * Both missing-reference scopes for one skill (see src/references.ts for why
     * the body notice uses the own-tree scope alone).
     * Cached per provider instance: the vendored tree is pinned by SHA-256.
     * @param skillName - served skill name.
     * @returns own-tree misses, shared-closure misses, and the shared files walked.
     */
    referenceScopesOf(skillName: string): Promise<SkillReferenceScopes>;
    /**
     * References this skill's own tree names that this package does not contain.
     * This is the body-notice scope only.
     * @param skillName - served skill name.
     * @returns distinct missing targets with their referencing files.
     */
    missingReferencesOf(skillName: string): Promise<readonly MissingReference[]>;
    /**
     * References the shared/ files this skill reaches name that this package does
     * not contain. Metadata only: it is identical for every skill that reaches the
     * same shared files, so it must never change a served body.
     * @param skillName - served skill name.
     * @returns distinct missing targets with their referencing files.
     */
    missingSharedReferencesOf(skillName: string): Promise<readonly MissingReference[]>;
    /** Map a candidate name back onto one served vendored skill. */
    private servedNameOf;
    /** Invocation-neutral fields shared by list() and get(). */
    private summaryOf;
    /** One discovery candidate for a served skill. */
    private candidateOf;
    /**
     * Provenance metadata for one skill: what its own frontmatter says, plus the
     * repository-level pin from vendor-manifest.json when the frontmatter is
     * silent (neither vendored SKILL.md declares a licence).
     */
    private metadataOf;
    /** Read vendor-manifest.json once per provider instance. */
    private vendorManifest;
}
/** Opening marker of the port notice; it is not upstream text. */
export declare const PORT_NOTICE_BEGIN = "<!-- dsh-academic-skills:port-notice:begin (not upstream text) -->";
/** Closing marker of the port notice. */
export declare const PORT_NOTICE_END = "<!-- dsh-academic-skills:port-notice:end -->";
/**
 * Render the port notice appended to one served skill body.
 *
 * Empty string when the skill's own tree names nothing missing, so a clean
 * skill is served byte-for-byte as vendored. The notice is clearly delimited,
 * says it is not upstream text, lists the paths, and gives exactly one
 * instruction: do not invent the missing content. A long list is truncated in
 * the body and carried in full in metadata.unavailableReferences.
 * @param skillName - served skill name (used to shorten source paths).
 * @param missing - missing targets with their referencing files.
 * @returns the notice block, or '' when nothing is missing.
 */
export declare function renderPortNotice(skillName: string, missing: readonly MissingReference[]): string;
/**
 * Read the repository-level vendored pin.
 * @param path - absolute vendor-manifest.json path.
 * @returns the recorded commit and licence, or undefined when unreadable.
 */
export declare function readVendorManifest(path: string): Promise<VendorManifest | undefined>;
/**
 * Register the vendored skill provider on ctx.skills.
 *
 * An unknown configured skill name throws here, before anything is served, so a
 * typo can never leave the profile with an empty catalog.
 * @param ctx - plugin context (injects skills).
 * @param config - resolved provider configuration.
 * @returns the disposer that unregisters the provider.
 */
export declare function registerReviewSkillProvider(ctx: Context, config: ReviewSkillProviderConfig): () => void;
export {};
