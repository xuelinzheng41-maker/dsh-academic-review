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
 * Scope is the skill's own markdown tree, deliberately not the shared/ tree it
 * points into: shared/ is reached by every served skill alike, and a notice
 * derived from it would fire for all of them (the reviewer's served body must
 * stay byte-identical to the reviewed upstream text). Dangling references
 * inside shared/ are surfaced by tests/skill-references.test.mjs instead, which
 * walks the whole vendored tree - including shared/ - so nothing is unreported.
 *
 * @param options.vendorBasePath - absolute vendor directory.
 * @param options.skillName - vendored skill directory name.
 * @returns distinct missing targets with their referencing files, sorted.
 */
export declare function missingReferencesForSkill(options: {
    vendorBasePath: string;
    skillName: string;
}): Promise<MissingReference[]>;
