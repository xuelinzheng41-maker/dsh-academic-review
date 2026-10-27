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
import { readdir, readFile, stat } from 'node:fs/promises';
import { join, posix, resolve } from 'node:path';
/** Markdown link with an inline destination and optional title. */
export const MARKDOWN_LINK = /\[[^\]]*\]\(([^)\s]+)(?:\s+"[^"]*")?\)/gu;
/** Bare shared/... path, not part of a longer path or URL. */
export const BARE_SHARED_PATH = /(?<![A-Za-z0-9_./-])shared\/[A-Za-z0-9_./<>{}*$-]+/gu;
/** Angle brackets, braces, stars and $ mark a template placeholder, not a path. */
export const PLACEHOLDER = /[<>{}*$]/u;
/** Every file under a directory, as POSIX paths relative to it. */
export async function walkFiles(directory, prefix = '') {
    const out = [];
    for (const entry of await readdir(directory, { withFileTypes: true })) {
        const relative = prefix === '' ? entry.name : prefix + '/' + entry.name;
        if (entry.isDirectory())
            out.push(...(await walkFiles(join(directory, entry.name), relative)));
        else
            out.push(relative);
    }
    return out;
}
/**
 * Whether a package-relative path exists (file or directory).
 * @param baseDirectory - absolute base the relative path is joined onto.
 * @param relative - POSIX path relative to that base.
 * @returns whether the target exists.
 */
export async function existsInside(baseDirectory, relative) {
    const base = resolve(baseDirectory);
    const absolute = resolve(base, relative);
    // Never follow a target out of the base, even if the path normalizes there.
    if (absolute !== base && !absolute.startsWith(base + (process.platform === 'win32' ? '\\' : '/')))
        return false;
    try {
        await stat(absolute);
        return true;
    }
    catch {
        return false;
    }
}
/** Strip a trailing sentence period and any #anchor from a raw reference. */
export function normalizeReference(raw) {
    return (raw.split('#')[0] ?? '').replace(/[.,;:!?]+$/u, '').replace(/^</u, '').replace(/>$/u, '');
}
/**
 * Resolve one reference to a package-relative POSIX path.
 * @param file - referencing file, vendor-relative POSIX path.
 * @param raw - reference text.
 * @param kind - how the reference was written.
 * @returns the normalized package-relative target.
 */
export function resolveReference(file, raw, kind) {
    if (kind === 'shared')
        return posix.normalize(raw);
    const directory = posix.dirname(file);
    return posix.normalize(posix.join(directory === '.' ? '' : directory, raw));
}
/**
 * Every reference found in one markdown file, in file order.
 * @param file - file the text came from, vendor-relative POSIX path.
 * @param text - file content.
 * @returns references, unresolved.
 */
export function referencesIn(file, text) {
    const found = [];
    for (const match of text.matchAll(MARKDOWN_LINK)) {
        const raw = match[1];
        if (raw === undefined || /^(?:https?:|mailto:|tel:|#)/iu.test(raw))
            continue;
        found.push({ file, raw, kind: 'link' });
    }
    for (const match of text.matchAll(BARE_SHARED_PATH)) {
        found.push({ file, raw: match[0], kind: 'shared' });
    }
    return found;
}
/**
 * Walk every markdown file of one vendored area and resolve its references.
 * @param options.vendorBasePath - absolute vendor directory.
 * @param options.skillName - restrict the walk to one vendored skill directory;
 *   omitted walks the whole vendored tree (skills plus shared/).
 * @returns the scan totals plus resolved and missing references.
 */
export async function scanVendorReferences(options) {
    const vendorBase = resolve(options.vendorBasePath);
    const areaDirectory = options.skillName === undefined ? vendorBase : join(vendorBase, options.skillName);
    const prefix = options.skillName === undefined ? '' : options.skillName + '/';
    const files = (await walkFiles(areaDirectory))
        .map(name => prefix + name)
        .filter(name => name.toLowerCase().endsWith('.md'))
        .sort();
    const resolved = [];
    const missing = [];
    let references = 0;
    let placeholders = 0;
    let links = 0;
    let sharedPaths = 0;
    for (const file of files) {
        const text = await readFile(join(vendorBase, file), 'utf8');
        for (const reference of referencesIn(file, text)) {
            const raw = normalizeReference(reference.raw);
            if (raw === '' || PLACEHOLDER.test(raw)) {
                placeholders += 1;
                continue;
            }
            references += 1;
            if (reference.kind === 'link')
                links += 1;
            else
                sharedPaths += 1;
            const target = resolveReference(file, raw, reference.kind);
            const entry = { ...reference, target, exists: await existsInside(vendorBase, target) };
            if (entry.exists)
                resolved.push(entry);
            else
                missing.push(entry);
        }
    }
    return { files, references, links, sharedPaths, placeholders, resolved, missing };
}
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
export async function missingReferencesForSkill(options) {
    const scan = await scanVendorReferences(options);
    const byTarget = new Map();
    for (const entry of scan.missing) {
        const sources = byTarget.get(entry.target) ?? new Set();
        sources.add(entry.file);
        byTarget.set(entry.target, sources);
    }
    return [...byTarget.entries()]
        .map(([target, sources]) => ({ target, sources: [...sources].sort() }))
        .sort((left, right) => (left.target < right.target ? -1 : left.target > right.target ? 1 : 0));
}
