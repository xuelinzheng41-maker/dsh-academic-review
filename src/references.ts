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

import { readdir, readFile, stat } from 'node:fs/promises'
import { join, posix, resolve } from 'node:path'

/** Inline code span, used to tell a syntax example from a real link. */
export const INLINE_CODE = /`[^`\n]*`/gu

/** Markdown link with an inline destination and optional title. */
export const MARKDOWN_LINK = /\[[^\]]*\]\(([^)\s]+)(?:\s+"[^"]*")?\)/gu
/** Bare shared/... path, not part of a longer path or URL. */
export const BARE_SHARED_PATH = /(?<![A-Za-z0-9_./-])shared\/[A-Za-z0-9_./<>{}*$-]+/gu
/** Angle brackets, braces, stars and $ mark a template placeholder, not a path. */
export const PLACEHOLDER = /[<>{}*$]/u

/** How a reference was written in the source file. */
export type ReferenceKind = 'link' | 'shared'

/** One reference as it appears in a vendored file. */
export interface VendoredReference {
  /** File the reference appears in, POSIX path relative to the vendor base. */
  readonly file: string
  /** The reference exactly as written. */
  readonly raw: string
  /** Markdown link or bare shared/ path. */
  readonly kind: ReferenceKind
  /** Package-relative POSIX target after normalization. */
  readonly target: string
}

/** One reference plus whether the package contains its target. */
export interface ResolvedReference extends VendoredReference {
  /** Whether the target exists under the vendor base. */
  readonly exists: boolean
}

/** Full result of walking one area of the vendored tree. */
export interface ReferenceScan {
  /** Markdown files walked, POSIX paths relative to the vendor base. */
  readonly files: readonly string[]
  /** References found, excluding template placeholders. */
  readonly references: number
  /** References written as markdown links. */
  readonly links: number
  /** References written as bare shared/ paths. */
  readonly sharedPaths: number
  /** Template placeholders skipped. */
  readonly placeholders: number
  /** References whose target the package contains. */
  readonly resolved: readonly ResolvedReference[]
  /** References whose target the package does not contain. */
  readonly missing: readonly ResolvedReference[]
}

/** One missing target and the files that ask the agent to read it. */
export interface MissingReference {
  /** Package-relative POSIX target that does not exist. */
  readonly target: string
  /** Referencing files (vendor-relative POSIX paths), sorted and de-duplicated. */
  readonly sources: readonly string[]
}

/** Every file under a directory, as POSIX paths relative to it. */
export async function walkFiles(directory: string, prefix = ''): Promise<string[]> {
  const out: string[] = []
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const relative = prefix === '' ? entry.name : prefix + '/' + entry.name
    if (entry.isDirectory()) out.push(...(await walkFiles(join(directory, entry.name), relative)))
    else out.push(relative)
  }
  return out
}

/**
 * Whether a package-relative path exists (file or directory).
 * @param baseDirectory - absolute base the relative path is joined onto.
 * @param relative - POSIX path relative to that base.
 * @returns whether the target exists.
 */
export async function existsInside(baseDirectory: string, relative: string): Promise<boolean> {
  const base = resolve(baseDirectory)
  const absolute = resolve(base, relative)
  // Never follow a target out of the base, even if the path normalizes there.
  if (absolute !== base && !absolute.startsWith(base + (process.platform === 'win32' ? '\\' : '/'))) return false
  try {
    await stat(absolute)
    return true
  } catch {
    return false
  }
}

/** Strip a trailing sentence period and any #anchor from a raw reference. */
export function normalizeReference(raw: string): string {
  return (raw.split('#')[0] ?? '').replace(/[.,;:!?]+$/u, '').replace(/^</u, '').replace(/>$/u, '')
}

/**
 * Resolve one reference to a package-relative POSIX path.
 * @param file - referencing file, vendor-relative POSIX path.
 * @param raw - reference text.
 * @param kind - how the reference was written.
 * @returns the normalized package-relative target.
 */
export function resolveReference(file: string, raw: string, kind: ReferenceKind): string {
  if (kind === 'shared') return posix.normalize(raw)
  const directory = posix.dirname(file)
  return posix.normalize(posix.join(directory === '.' ? '' : directory, raw))
}

/**
 * Every reference found in one markdown file, in file order.
 * @param file - file the text came from, vendor-relative POSIX path.
 * @param text - file content.
 * @returns references, unresolved.
 */
export function referencesIn(file: string, text: string): { file: string; raw: string; kind: ReferenceKind }[] {
  const found: { file: string; raw: string; kind: ReferenceKind }[] = []
  const codeSpans: [number, number][] = []
  for (const span of text.matchAll(INLINE_CODE)) {
    const start = span.index ?? 0
    codeSpans.push([start, start + span[0].length])
  }
  const insideCode = (index: number): boolean => codeSpans.some(([start, end]) => index >= start && index < end)
  for (const match of text.matchAll(MARKDOWN_LINK)) {
    const raw = match[1]
    if (raw === undefined || /^(?:https?:|mailto:|tel:|#)/iu.test(raw)) continue
    // A markdown link written INSIDE an inline code span is an example of markdown
    // syntax, not a reference: the academic-paper formatter documents `[text](url)`
    // and `![caption](path)` in its LaTeX conversion table. Bare shared/ paths in
    // code spans stay references - that is how the skills quote protocol files.
    if (insideCode(match.index ?? 0)) continue
    found.push({ file, raw, kind: 'link' })
  }
  for (const match of text.matchAll(BARE_SHARED_PATH)) {
    found.push({ file, raw: match[0], kind: 'shared' })
  }
  return found
}

/**
 * Walk every markdown file of one vendored area and resolve its references.
 * @param options.vendorBasePath - absolute vendor directory.
 * @param options.skillName - restrict the walk to one vendored skill directory;
 *   omitted walks the whole vendored tree (skills plus shared/).
 * @returns the scan totals plus resolved and missing references.
 */
export async function scanVendorReferences(options: {
  vendorBasePath: string
  skillName?: string
}): Promise<ReferenceScan> {
  const vendorBase = resolve(options.vendorBasePath)
  const areaDirectory = options.skillName === undefined ? vendorBase : join(vendorBase, options.skillName)
  const prefix = options.skillName === undefined ? '' : options.skillName + '/'
  const files = (await walkFiles(areaDirectory))
    .map(name => prefix + name)
    .filter(name => name.toLowerCase().endsWith('.md'))
    .sort()
  const resolved: ResolvedReference[] = []
  const missing: ResolvedReference[] = []
  let references = 0
  let placeholders = 0
  let links = 0
  let sharedPaths = 0
  for (const file of files) {
    const text = await readFile(join(vendorBase, file), 'utf8')
    for (const reference of referencesIn(file, text)) {
      const raw = normalizeReference(reference.raw)
      if (raw === '' || PLACEHOLDER.test(raw)) {
        placeholders += 1
        continue
      }
      references += 1
      if (reference.kind === 'link') links += 1
      else sharedPaths += 1
      const target = resolveReference(file, raw, reference.kind)
      const entry: ResolvedReference = { ...reference, target, exists: await existsInside(vendorBase, target) }
      if (entry.exists) resolved.push(entry)
      else missing.push(entry)
    }
  }
  return { files, references, links, sharedPaths, placeholders, resolved, missing }
}

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
export async function missingReferencesForSkill(options: {
  vendorBasePath: string
  skillName: string
}): Promise<MissingReference[]> {
  const scan = await scanVendorReferences(options)
  return groupByTarget(scan.missing)
}

/** The two missing-reference scopes one skill can be reported against. */
export interface SkillReferenceScopes {
  /** Misses named by the skill's own markdown tree (the body-notice scope). */
  readonly own: readonly MissingReference[]
  /** Misses named by the shared/ markdown this skill reaches (metadata only). */
  readonly shared: readonly MissingReference[]
  /** Shared markdown files reached, vendor-relative POSIX paths, sorted. */
  readonly sharedFiles: readonly string[]
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
export async function missingReferencesByScope(options: {
  vendorBasePath: string
  skillName: string
}): Promise<SkillReferenceScopes> {
  const vendorBase = resolve(options.vendorBasePath)
  const ownScan = await scanVendorReferences(options)
  const own = groupByTarget(ownScan.missing)

  // Seed the shared closure from the shared/ markdown this skill reaches.
  const queue = ownScan.resolved
    .map(entry => entry.target)
    .filter(target => isSharedMarkdown(target))
  const walked = new Set<string>()
  const sharedMissing: ResolvedReference[] = []
  while (queue.length > 0) {
    const file = queue.shift()
    if (file === undefined || walked.has(file)) continue
    walked.add(file)
    let text: string
    try {
      text = await readFile(join(vendorBase, file), 'utf8')
    } catch {
      // A shared file that vanished between walks is already reported as missing
      // by the own-tree scan; do not fail the whole load on it.
      continue
    }
    for (const reference of referencesIn(file, text)) {
      const raw = normalizeReference(reference.raw)
      if (raw === '' || PLACEHOLDER.test(raw)) continue
      const target = resolveReference(file, raw, reference.kind)
      const exists = await existsInside(vendorBase, target)
      const entry: ResolvedReference = { ...reference, target, exists }
      if (!exists) {
        sharedMissing.push(entry)
        continue
      }
      if (isSharedMarkdown(target) && !walked.has(target)) queue.push(target)
    }
  }

  return {
    own,
    shared: groupByTarget(sharedMissing),
    sharedFiles: [...walked].sort(),
  }
}

/** Whether a package-relative target is markdown inside the shared/ tree. */
function isSharedMarkdown(target: string): boolean {
  return target.startsWith('shared/') && target.toLowerCase().endsWith('.md')
}

/** Collapse resolved references into one row per distinct missing target. */
function groupByTarget(entries: readonly ResolvedReference[]): MissingReference[] {
  const byTarget = new Map<string, Set<string>>()
  for (const entry of entries) {
    const sources = byTarget.get(entry.target) ?? new Set<string>()
    sources.add(entry.file)
    byTarget.set(entry.target, sources)
  }
  return [...byTarget.entries()]
    .map(([target, sources]) => ({ target, sources: [...sources].sort() }))
    .sort((left, right) => (left.target < right.target ? -1 : left.target > right.target ? 1 : 0))
}