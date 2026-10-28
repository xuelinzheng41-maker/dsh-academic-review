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

import { existsSync, readdirSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { renderWritePolicyBlock, writePolicyMetadataOf } from './write-policy.ts'
import {
  missingReferencesByScope,
  missingReferencesForSkill,
  type MissingReference,
  type SkillReferenceScopes,
} from './references.ts'
import type { Context } from '@deepseek-ai/cordis'
import type {
  SkillCandidate,
  SkillDefinition,
  SkillLookupOptions,
  SkillProvider,
  SkillProviderControl,
  SkillResourceBase,
} from '@deepseek-ai/dsh-skill'

/** Instruction file inside every vendored skill directory. */
export const SKILL_INSTRUCTION_FILE = 'SKILL.md'
/** Advertised name of the reviewer skill (upstream name, unchanged). */
export const REVIEW_SKILL_NAME = 'academic-paper-reviewer'
/** Advertised name of the deep-research skill (upstream name, unchanged). */
export const DEEP_RESEARCH_SKILL_NAME = 'deep-research'
/** Precedence rank: below project skills (100/200) and above user skills (400+). */
export const REVIEW_SKILL_RANK = 450
/** Discovery source bucket reported for every vendored skill. */
export const REVIEW_SKILL_SOURCE = 'bundled'
/** Vendored directory that holds files shared between skills, not a skill itself. */
export const SHARED_VENDOR_DIRECTORY = 'shared'
/** Repository-level pin file written by the vendoring script. */
export const VENDOR_MANIFEST_FILE = 'vendor-manifest.json'

/** Kebab-case grammar the registry addresses skills by. */
const SKILL_NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u

/** Plugin package root resolved from this module's own URL (lib/skills.js). */
export function packageRoot(): string {
  return resolve(dirname(fileURLToPath(import.meta.url)), '..')
}

/**
 * Default vendor directory: <package root>/vendor.
 * @returns absolute directory path.
 */
export function defaultVendorBasePath(): string {
  return join(packageRoot(), 'vendor')
}

/**
 * Default directory of the reviewer skill: <package root>/vendor/<reviewer>.
 * Kept because it is the resource base every other module and doc cites.
 * @returns absolute directory path.
 */
export function defaultResourceBasePath(): string {
  return skillResourceBasePath(defaultVendorBasePath(), REVIEW_SKILL_NAME)
}

/**
 * Absolute directory of one vendored skill.
 * @param vendorBasePath - absolute vendor directory.
 * @param skillName - vendored skill directory name.
 * @returns absolute skill directory path.
 */
export function skillResourceBasePath(vendorBasePath: string, skillName: string): string {
  return join(resolve(vendorBasePath), skillName)
}

/**
 * Every skill vendored under one vendor directory, sorted by name.
 * A directory counts as a skill only when it holds SKILL.md, so the shared/
 * tree is never mistaken for one.
 * @param vendorBasePath - absolute vendor directory.
 * @returns sorted skill directory names (empty when the directory is absent).
 */
export function discoverVendoredSkills(vendorBasePath: string): string[] {
  const base = resolve(vendorBasePath)
  let entries: string[] = []
  try {
    entries = readdirSync(base, { withFileTypes: true })
      .filter(entry => entry.isDirectory() && entry.name !== SHARED_VENDOR_DIRECTORY)
      .filter(entry => existsSync(join(base, entry.name, SKILL_INSTRUCTION_FILE)))
      .map(entry => entry.name)
  } catch {
    return []
  }
  return entries.sort()
}

/** Selection failure raised before the provider can serve anything. */
export class UnknownSkillSelectionError extends Error {
  /** Vendored skill names that do exist. */
  readonly available: readonly string[]
  /** Names the configuration asked for. */
  readonly requested: readonly string[]

  constructor(requested: readonly string[], available: readonly string[], vendorBasePath: string) {
    const missing = requested.filter(name => !available.includes(name))
    super('unknown vendored skill' + (missing.length === 1 ? ' ' : 's ')
      + missing.map(name => '"' + name + '"').join(', ')
      + ': ' + (available.length === 0
        ? 'nothing is vendored under ' + resolve(vendorBasePath)
          + ' (expected <vendor>/<skill>/' + SKILL_INSTRUCTION_FILE + ')'
        : 'available skills are ' + available.join(', ')))
    this.name = 'UnknownSkillSelectionError'
    this.available = available
    this.requested = requested
  }
}

/**
 * Resolve the skill names to serve.
 * @param vendorBasePath - absolute vendor directory.
 * @param requested - configured subset; omitted or empty serves everything.
 * @returns the selected skill names, every one of them verified present.
 */
export function resolveSkillSelection(
  vendorBasePath: string,
  requested?: readonly string[],
): string[] {
  const available = discoverVendoredSkills(vendorBasePath)
  const wanted = (requested ?? []).map(name => name.trim()).filter(name => name !== '')
  if (wanted.length === 0) {
    if (available.length === 0) {
      throw new UnknownSkillSelectionError([], available, vendorBasePath)
    }
    return available
  }
  for (const name of wanted) {
    if (!SKILL_NAME.test(name) || !available.includes(name)) {
      throw new UnknownSkillSelectionError(wanted, available, vendorBasePath)
    }
  }
  // Preserve the vendored order while honouring the narrowed selection.
  return available.filter(name => wanted.includes(name))
}

/** Parsed SKILL.md frontmatter and body. */
export interface SkillDocument {
  /** Advertised skill name from the frontmatter. */
  readonly name?: string
  /** Routing description from the frontmatter. */
  readonly description?: string
  /** Top-level frontmatter scalars (name, description, license, ...). */
  readonly fields: Readonly<Record<string, string>>
  /** Scalars nested one level under the frontmatter's `metadata:` block. */
  readonly metadata: Readonly<Record<string, string>>
  /** Instruction body, byte-for-byte. */
  readonly body: string
}

/**
 * Split a Markdown skill file into its YAML frontmatter fields and body.
 * The parser is deliberately minimal: the vendored frontmatter is scalars and
 * one nested `metadata:` map of scalars, and the body is passed through
 * byte-for-byte.
 * @param text - raw file content.
 * @returns parsed frontmatter fields plus the body.
 */
export function parseSkillDocument(text: string): SkillDocument {
  const normalized = text.replace(/^\uFEFF/, '')
  const empty: SkillDocument = { fields: {}, metadata: {}, body: normalized }
  if (!normalized.startsWith('---')) return empty
  const end = normalized.indexOf('\n---', 3)
  if (end === -1) return empty
  const frontmatter = normalized.slice(3, end)
  const bodyStart = normalized.indexOf('\n', end + 1)
  const body = bodyStart === -1 ? '' : normalized.slice(bodyStart + 1)
  const fields: Record<string, string> = {}
  const metadata: Record<string, string> = {}
  let section: string | undefined
  for (const line of frontmatter.split(/\r?\n/)) {
    if (line.trim() === '' || line.trimStart().startsWith('#')) continue
    const nested = /^[ \t]+([A-Za-z0-9_-]+):\s*(.*)$/u.exec(line)
    if (nested !== null) {
      if (section === 'metadata') {
        const key = nested[1]
        const value = unquote(nested[2] ?? '')
        // Empty nested keys are either list headers (related_skills) or
        // undeclared scalars; neither is metadata this provider reports.
        if (key !== undefined && value !== '') metadata[key] = value
      }
      continue
    }
    const top = /^([A-Za-z0-9_-]+):\s*(.*)$/u.exec(line)
    if (top === null) continue
    const key = top[1] ?? ''
    const raw = (top[2] ?? '').trim()
    section = raw === '' ? key : undefined
    if (raw !== '') fields[key] = unquote(raw)
  }
  return {
    ...(fields['name'] === undefined ? {} : { name: fields['name'] }),
    ...(fields['description'] === undefined ? {} : { description: fields['description'] }),
    fields,
    metadata,
    body,
  }
}

/** Strip one layer of surrounding quotes from a frontmatter scalar. */
function unquote(value: string): string {
  const trimmed = value.trim()
  if (trimmed.length >= 2) {
    const first = trimmed.charAt(0)
    const last = trimmed.charAt(trimmed.length - 1)
    if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
      return trimmed.slice(1, -1).replace(/\\"/g, '"')
    }
  }
  return trimmed
}

/** Repository-level pin read from vendor-manifest.json. */
interface VendorManifest {
  /** Vendored upstream commit, when the manifest records one. */
  readonly commit?: string
  /** Repository licence covering the vendored trees. */
  readonly license?: string
}

/** Provider configuration resolved by the plugin. */
export interface ReviewSkillProviderConfig {
  /** Provider name registered on ctx.skills. */
  readonly providerName: string
  /** Absolute vendor directory holding every vendored skill (default <package root>/vendor). */
  readonly vendorBasePath?: string
  /** Skill subset to serve; defaults to every vendored skill present. */
  readonly skills?: readonly string[]
  /** Precedence rank; defaults to REVIEW_SKILL_RANK. */
  readonly rank?: number
}

/** Read-only skill provider over N vendored skill directories. */
export class VendoredSkillsProvider implements SkillProvider {
  /** Provider name used by the skill registry. */
  readonly name: string
  /** Absolute vendor directory. */
  readonly vendorBasePath: string
  /** Skill names this provider serves, in vendored order. */
  readonly skillNames: readonly string[]
  /** Precedence rank. */
  readonly rank: number
  /** Registration lifecycle, borrowed from the registry. */
  private readonly control: SkillProviderControl
  /** Per-skill reference-scope cache; the vendored tree is pinned per install. */
  private readonly scopesBySkill = new Map<string, Promise<SkillReferenceScopes>>()
  /** Lazily read repository pin, undefined when the manifest is unusable. */
  private manifest: Promise<VendorManifest | undefined> | undefined

  constructor(config: ReviewSkillProviderConfig, control: SkillProviderControl, skillNames?: readonly string[]) {
    this.name = config.providerName
    this.vendorBasePath = resolve(config.vendorBasePath ?? defaultVendorBasePath())
    this.skillNames = skillNames ?? resolveSkillSelection(this.vendorBasePath, config.skills)
    this.rank = config.rank ?? REVIEW_SKILL_RANK
    this.control = control
  }

  /** Absolute skill directory of one served skill. */
  resourceBasePathOf(skillName: string): string {
    return skillResourceBasePath(this.vendorBasePath, skillName)
  }

  /** Absolute instruction file of one served skill. */
  instructionPathOf(skillName: string): string {
    return join(this.resourceBasePathOf(skillName), SKILL_INSTRUCTION_FILE)
  }

  /** Resource base advertised to the model for one served skill. */
  resourceBaseOf(skillName: string): SkillResourceBase {
    return { kind: 'directory', path: this.resourceBasePathOf(skillName) }
  }

  /**
   * List every served vendored skill.
   * A missing instruction file is a hard discovery failure rather than a silent
   * empty catalog, so a broken install is visible instead of invisible.
   * @param options - lookup options; the signal cancels discovery.
   * @returns one candidate per served skill.
   */
  async list(options: SkillLookupOptions = {}): Promise<readonly SkillCandidate[]> {
    if (options.signal?.aborted === true) throw new Error('skill discovery aborted')
    const candidates: SkillCandidate[] = []
    for (const skillName of this.skillNames) {
      const directory = this.resourceBasePathOf(skillName)
      const path = join(directory, SKILL_INSTRUCTION_FILE)
      const raw = await readFile(path, 'utf8')
      candidates.push(this.candidateOf(skillName, directory, path, parseSkillDocument(raw)))
    }
    return candidates
  }

  /**
   * Load one served skill body.
   * @param candidate - candidate previously returned by this provider.
   * @param options - lookup options; the signal cancels the read.
   * @returns the complete skill definition, or undefined if the file vanished.
   */
  async get(
    candidate: SkillCandidate,
    options: SkillLookupOptions = {},
  ): Promise<SkillDefinition | undefined> {
    if (options.signal?.aborted === true) throw new Error('skill load aborted')
    const locator = candidate.locator as { path?: unknown; directory?: unknown } | undefined
    const skillName = this.servedNameOf(candidate.name, locator)
    const directory = this.resourceBasePathOf(skillName)
    const path = typeof locator?.path === 'string' ? locator.path : join(directory, SKILL_INSTRUCTION_FILE)
    let raw: string
    try {
      raw = await readFile(path, 'utf8')
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
      throw error
    }
    void this.control
    const document = parseSkillDocument(raw)
    const scopes = await this.referenceScopesOf(skillName)
    return {
      ...this.summaryOf(skillName, directory, path, document),
      // Byte-identical to the vendored body when the skill's own tree is clean.
      // Shared-tree misses are metadata only: they are identical for every skill
      // reaching the same shared files, so a body notice would change bodies it
      // has no business changing (src/references.ts documents the three scopes).
      // Write policy A is PREPENDED to EVERY skill, unconditionally: the rule has to
      // be read before the instructions it governs, and we cannot prove a skill never
      // writes (three adversarial shapes defeat the detector; see the rationale in
      // src/write-policy.ts). The renderer takes no skill name because the block is a
      // constant - nothing here decides whether the rule applies. It is an
      // instruction, not an interlock: the plugin never sees the host's file tools.
      content: renderWritePolicyBlock() + document.body + renderPortNotice(skillName, scopes.own),
      metadata: {
        ...(await this.metadataOf(skillName, directory, document)),
        ...writePolicyMetadataOf(skillName),
        unavailableReferences: scopes.own.map(entry => entry.target),
        unavailableReferenceCount: scopes.own.length,
        unavailableSharedReferences: scopes.shared.map(entry => entry.target),
        unavailableSharedReferenceCount: scopes.shared.length,
      },
    }
  }

  /**
   * Both missing-reference scopes for one skill (see src/references.ts for why
   * the body notice uses the own-tree scope alone).
   * Cached per provider instance: the vendored tree is pinned by SHA-256.
   * @param skillName - served skill name.
   * @returns own-tree misses, shared-closure misses, and the shared files walked.
   */
  async referenceScopesOf(skillName: string): Promise<SkillReferenceScopes> {
    const cached = this.scopesBySkill.get(skillName)
    if (cached !== undefined) return cached
    const pending = missingReferencesByScope({ vendorBasePath: this.vendorBasePath, skillName })
    this.scopesBySkill.set(skillName, pending)
    return pending
  }

  /**
   * References this skill's own tree names that this package does not contain.
   * This is the body-notice scope only.
   * @param skillName - served skill name.
   * @returns distinct missing targets with their referencing files.
   */
  async missingReferencesOf(skillName: string): Promise<readonly MissingReference[]> {
    return (await this.referenceScopesOf(skillName)).own
  }

  /**
   * References the shared/ files this skill reaches name that this package does
   * not contain. Metadata only: it is identical for every skill that reaches the
   * same shared files, so it must never change a served body.
   * @param skillName - served skill name.
   * @returns distinct missing targets with their referencing files.
   */
  async missingSharedReferencesOf(skillName: string): Promise<readonly MissingReference[]> {
    return (await this.referenceScopesOf(skillName)).shared
  }

  /** Map a candidate name back onto one served vendored skill. */
  private servedNameOf(name: string, locator: { directory?: unknown } | undefined): string {
    if (this.skillNames.includes(name)) return name
    const directory = typeof locator?.directory === 'string' ? locator.directory : undefined
    const byDirectory = directory === undefined
      ? undefined
      : this.skillNames.find(skillName => this.resourceBasePathOf(skillName) === resolve(directory))
    return byDirectory ?? name
  }

  /** Invocation-neutral fields shared by list() and get(). */
  private summaryOf(
    skillName: string,
    directory: string,
    path: string,
    document: SkillDocument,
  ): Omit<SkillDefinition, 'content' | 'metadata'> {
    const advertised = document.name !== undefined && SKILL_NAME.test(document.name)
      ? document.name
      : skillName
    const trigger = triggerHint(document.description)
    return {
      name: advertised,
      description: document.description?.trim() === undefined || document.description.trim() === ''
        ? fallbackDescription(skillName)
        : document.description.trim(),
      ...(trigger === undefined ? {} : { whenToUse: trigger }),
      invocation: { modelInvocable: true, userInvocable: true },
      source: REVIEW_SKILL_SOURCE,
      provider: this.name,
      resourceBase: { kind: 'directory', path: directory },
      path,
    }
  }

  /** One discovery candidate for a served skill. */
  private candidateOf(
    skillName: string,
    directory: string,
    path: string,
    document: SkillDocument,
  ): SkillCandidate {
    return {
      ...this.summaryOf(skillName, directory, path, document),
      rank: this.rank,
      locator: { path, directory, vendorBasePath: this.vendorBasePath, skillName },
    }
  }

  /**
   * Provenance metadata for one skill: what its own frontmatter says, plus the
   * repository-level pin from vendor-manifest.json when the frontmatter is
   * silent (neither vendored SKILL.md declares a licence).
   */
  private async metadataOf(
    skillName: string,
    directory: string,
    document: SkillDocument,
  ): Promise<Readonly<Record<string, unknown>>> {
    const manifest = await this.vendorManifest()
    const declaredLicense = scalar(document, 'license')
    const version = scalar(document, 'version')
    const lastUpdated = scalar(document, 'last_updated') ?? scalar(document, 'lastUpdated')
    const license = declaredLicense ?? manifest?.license
    return {
      upstreamSkill: skillName,
      upstreamSkillVersion: version ?? 'undeclared',
      ...(lastUpdated === undefined ? {} : { upstreamLastUpdated: lastUpdated }),
      license: license ?? 'undeclared',
      licenseSource: declaredLicense !== undefined
        ? 'frontmatter'
        : manifest?.license === undefined ? 'undeclared' : 'vendor-manifest',
      ...(manifest?.commit === undefined ? {} : { upstreamCommit: manifest.commit }),
      unofficialPort: true,
      vendorDirectory: directory,
    }
  }

  /** Read vendor-manifest.json once per provider instance. */
  private vendorManifest(): Promise<VendorManifest | undefined> {
    if (this.manifest === undefined) {
      this.manifest = readVendorManifest(join(packageRoot(), VENDOR_MANIFEST_FILE))
    }
    return this.manifest
  }
}

/** Read a frontmatter scalar: top-level field first, then the metadata block. */
function scalar(document: SkillDocument, key: string): string | undefined {
  const value = document.fields[key] ?? document.metadata[key]
  const trimmed = value?.trim()
  return trimmed === undefined || trimmed === '' ? undefined : trimmed
}

/** Routing hint derived from the frontmatter's own trigger list. */
function triggerHint(description: string | undefined): string | undefined {
  if (description === undefined) return undefined
  // Upstream phrases this list two ways: 'Triggers on:' in the reviewer and
  // deep-research skills, plain 'Triggers:' in academic-paper. Both are the skill's
  // own trigger list, so both are served; when neither marker is present nothing is
  // invented and whenToUse stays absent.
  const marker = description.includes('Triggers on:')
    ? 'Triggers on:'
    : description.includes('Triggers:')
      ? 'Triggers:'
      : undefined
  if (marker === undefined) return undefined
  const triggers = description.slice(description.indexOf(marker) + marker.length).trim().replace(/[.]$/u, '')
  return triggers === '' ? undefined : 'Triggers on: ' + triggers
}

/** Opening marker of the port notice; it is not upstream text. */
export const PORT_NOTICE_BEGIN = '<!-- dsh-academic-skills:port-notice:begin (not upstream text) -->'
/** Closing marker of the port notice. */
export const PORT_NOTICE_END = '<!-- dsh-academic-skills:port-notice:end -->'
/** Bullets the body notice may carry before it defers to metadata. */
const PORT_NOTICE_MAX_ITEMS = 6

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
export function renderPortNotice(skillName: string, missing: readonly MissingReference[]): string {
  if (missing.length === 0) return ''
  const plural = missing.length === 1 ? 'file' : 'files'
  const lines: string[] = [
    '',
    PORT_NOTICE_BEGIN,
    '**Port notice - not upstream text.** This DSH port does not ship '
      + String(missing.length) + ' ' + plural + ' that this skill\'s own instructions tell you to read:',
    '',
  ]
  for (const entry of missing.slice(0, PORT_NOTICE_MAX_ITEMS)) {
    const sources = entry.sources
      .map(source => (source.startsWith(skillName + '/') ? source.slice(skillName.length + 1) : source))
      .join(', ')
    lines.push('- `' + entry.target + '` - named by `' + sources + '`')
  }
  if (missing.length > PORT_NOTICE_MAX_ITEMS) {
    lines.push('- and ' + String(missing.length - PORT_NOTICE_MAX_ITEMS) + ' more (metadata.unavailableReferences)')
  }
  lines.push(
    '',
    'Do not fabricate or paraphrase the content of these files. If a step needs one, say the',
    'reference is unavailable in this port, continue with the material that is present, and',
    'tell the user which reference is missing.',
    PORT_NOTICE_END,
  )
  return lines.join('\n') + '\n'
}

/** Description used when the vendored frontmatter has none. */
function fallbackDescription(skillName: string): string {
  return 'Vendored Academic Research Skills protocol ' + skillName
    + ' (see its SKILL.md; the frontmatter declares no description).'
}

/**
 * Read the repository-level vendored pin.
 * @param path - absolute vendor-manifest.json path.
 * @returns the recorded commit and licence, or undefined when unreadable.
 */
export async function readVendorManifest(path: string): Promise<VendorManifest | undefined> {
  let raw: string
  try {
    raw = await readFile(path, 'utf8')
  } catch {
    return undefined
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return undefined
  }
  const upstream = (parsed as { upstream?: unknown }).upstream
  if (typeof upstream !== 'object' || upstream === null) return undefined
  const commit = (upstream as { commit?: unknown }).commit
  const license = (upstream as { license?: unknown }).license
  return {
    ...(typeof commit === 'string' && commit !== '' ? { commit } : {}),
    ...(typeof license === 'string' && license !== '' ? { license } : {}),
  }
}

/**
 * Register the vendored skill provider on ctx.skills.
 *
 * An unknown configured skill name throws here, before anything is served, so a
 * typo can never leave the profile with an empty catalog.
 * @param ctx - plugin context (injects skills).
 * @param config - resolved provider configuration.
 * @returns the disposer that unregisters the provider.
 */
export function registerReviewSkillProvider(ctx: Context, config: ReviewSkillProviderConfig): () => void {
  const skillNames = resolveSkillSelection(
    resolve(config.vendorBasePath ?? defaultVendorBasePath()),
    config.skills,
  )
  return ctx.skills.registerProvider(
    control => new VendoredSkillsProvider(config, control, skillNames),
  )
}