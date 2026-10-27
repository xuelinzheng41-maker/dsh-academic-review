/**
 * Reference scanner for the vendored skill trees.
 *
 * A vendored skill whose internal references dangle is worse than no skill: the
 * agent is told to read a path that does not exist and improvises instead. This
 * module is the single implementation of "what does this skill tell the agent to
 * open, and does this package actually contain it", shared by:
 *
 * - tests/skill-references.test.mjs, which asserts the whole vendored tree is
 *   reference-clean except for the recorded out-of-port areas;
 * - src/skills.ts, which appends a port notice to a served body when its own
 *   tree names a file this package does not ship.
 *
 * What counts as a reference:
 * - markdown links [text](target) whose target is not http(s)/mailto/tel/#anchor;
 * - bare shared/... paths in prose or code spans.
 * Template placeholders (shared/contracts/<domain>/<mode>.json), brace/star/$
 * patterns and a bare "shared/" are not references and are counted separately.
 *
 * Targets always resolve to a POSIX path relative to the vendor base, so a
 * reference can never escape the vendored tree: "../../academic-pipeline/x.md"
 * normalizes to "academic-pipeline/x.md", which simply does not exist here and
 * is therefore reported as missing rather than silently followed.
 *
 * THREE SCOPES, AND WHY THEY DIFFER (read this before changing a caller)
 *
 * 1. Own tree only (one skill's markdown): what {@link missingReferencesForSkill}
 *    returns, and the only scope whose misses are allowed to change a served
 *    body (src/skills.ts appends its port notice). It is the set the skill's own
 *    instructions name, so a notice derived from it is attributable to that
 *    skill alone.
 * 2. Shared closure (own tree + the shared/ markdown it reaches, transitively):
 *    what {@link missingReferencesByScope} reports as its `shared` scope. shared/
 *    is reached by every served skill alike - measured on this tree, both
 *    academic-paper-reviewer and deep-research reach 14 distinct missing targets
 *    - so a body notice from this scope would fire identically on both skills and
 *    would change the reviewer's served bytes. It is therefore metadata-only
 *    (metadata.unavailableSharedReferences) in this round; a later round either
 *    vendors those targets or phrases a shared-scope notice deliberately.
 * 3. Whole vendored tree (skills + shared/): what tests/skill-references.test.mjs
 *    asserts against the allowlisted out-of-port areas, so nothing in the tree
 *    goes unreported even when it is not attributed to one skill.
 *
 * @module dsh-academic-review/references
 */
/** Markdown link with an inline destination and optional title. */
export declare const MARKDOWN_LINK: RegExp;
/** Bare shared/... path, not part of a longer path or URL. */
export declare const BARE_SHARED_PATH: RegExp;
/** Angle brackets, braces, stars and $ mark a template placeholder, not a path. */
export declare const PLACEHOLDER: RegExp;
/** How a reference was written in the source file. */
export type ReferenceKind = 'link' | 'shared';
/** One reference as it appears in a vendored file. */
export interface VendoredReference {
    /** File the reference appears in, POSIX path relative to the vendor base. */
    readonly file: string;
    /** The reference exactly as written. */
    readonly raw: string;
    /** Markdown link or bare shared/ path. */
    readonly kind: ReferenceKind;
    /** Package-relative POSIX target after normalization. */
    readonly target: string;
}
/** One reference plus whether the package contains its target. */
export interface ResolvedReference extends VendoredReference {
    /** Whether the target exists under the vendor base. */
    readonly exists: boolean;
}
/** Full result of walking one area of the vendored tree. */
export interface ReferenceScan {
    /** Markdown files walked, POSIX paths relative to the vendor base. */
    readonly files: readonly string[];
    /** References found, excluding template placeholders. */
    readonly references: number;
    /** References written as markdown links. */
    readonly links: number;
    /** References written as bare shared/ paths. */
    readonly sharedPaths: number;
    /** Template placeholders skipped. */
    readonly placeholders: number;
    /** References whose target the package contains. */
    readonly resolved: readonly ResolvedReference[];
    /** References whose target the package does not contain. */
    readonly missing: readonly ResolvedReference[];
}
/** One missing target and the files that ask the agent to read it. */
export interface MissingReference {
    /** Package-relative POSIX target that does not exist. */
    readonly target: string;
    /** Referencing files (vendor-relative POSIX paths), sorted and de-duplicated. */
    readonly sources: readonly string[];
}
/** Every file under a directory, as POSIX paths relative to it. */
export declare function walkFiles(directory: string, prefix?: string): Promise<string[]>;
/**
 * Whether a package-relative path exists (file or directory).
 * @param baseDirectory - absolute base the relative path is joined onto.
 * @param relative - POSIX path relative to that base.
 * @returns whether the target exists.
 */
export declare function existsInside(baseDirectory: string, relative: string): Promise<boolean>;
/** Strip a trailing sentence period and any #anchor from a raw reference. */
export declare function normalizeReference(raw: string): string;
/**
 * Resolve one reference to a package-relative POSIX path.
 * @param file - referencing file, vendor-relative POSIX path.
 * @param raw - reference text.
 * @param kind - how the reference was written.
 * @returns the normalized package-relative target.
 */
export declare function resolveReference(file: string, raw: string, kind: ReferenceKind): string;
/**
 * Every reference found in one markdown file, in file order.
 * @param file - file the text came from, vendor-relative POSIX path.
 * @param text - file content.
 * @returns references, unresolved.
 */
export declare function referencesIn(file: string, text: string): {
    file: string;
    raw: string;
    kind: ReferenceKind;
}[];
/**
 * Walk every markdown file of one vendored area and resolve its references.
 * @param options.vendorBasePath - absolute vendor directory.
 * @param options.skillName - restrict the walk to one vendored skill directory;
 *   omitted walks the whole vendored tree (skills plus shared/).
 * @returns the scan totals plus resolved and missing references.
 */
export declare function scanVendorReferences(options: {
    vendorBasePath: string;
    skillName?: string;
}): Promise<ReferenceScan>;
/**
 * The references one skill's own tree names that this package does not contain.
 *
 * This is reading 1 of the three scopes documented in the module header: the
 * skill's own markdown tree, deliberately not the shared/ tree it points into.
 * A body notice must be attributable to one skill, and shared/ is reached by
 * every served skill alike (see {@link missingReferencesByScope}, reading 2,
 * which reports those misses as metadata only). Nothing is left unreported:
 * tests/skill-references.test.mjs walks the whole vendored tree (reading 3).
 *
 * @param options.vendorBasePath - absolute vendor directory.
 * @param options.skillName - vendored skill directory name.
 * @returns distinct missing targets with their referencing files, sorted.
 */
export declare function missingReferencesForSkill(options: {
    vendorBasePath: string;
    skillName: string;
}): Promise<MissingReference[]>;
/** The two missing-reference scopes one skill can be reported against. */
export interface SkillReferenceScopes {
    /** Misses named by the skill's own markdown tree (the body-notice scope). */
    readonly own: readonly MissingReference[];
    /** Misses named by the shared/ markdown this skill reaches (metadata only). */
    readonly shared: readonly MissingReference[];
    /** Shared markdown files reached, vendor-relative POSIX paths, sorted. */
    readonly sharedFiles: readonly string[];
}
/**
 * Missing references for one skill, split into the own-tree scope and the
 * shared/-closure scope (see the three-scope note in the module documentation).
 *
 * The shared scope walks only markdown the skill actually reaches: it starts
 * from the shared/ files the skill's own tree names, then follows shared/ to
 * shared/ references to a fixpoint, so a shared file nobody reaches is not
 * attributed to any skill.
 *
 * @param options.vendorBasePath - absolute vendor directory.
 * @param options.skillName - vendored skill directory name.
 * @returns both scopes plus the shared files that were walked.
 */
export declare function missingReferencesByScope(options: {
    vendorBasePath: string;
    skillName: string;
}): Promise<SkillReferenceScopes>;
