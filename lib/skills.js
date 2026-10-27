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
import { readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
/** Public skill name addressed by the model (upstream name, unchanged). */
export const REVIEW_SKILL_NAME = 'academic-paper-reviewer';
/** Precedence rank: below project skills (100/200) and above user skills (400+). */
export const REVIEW_SKILL_RANK = 450;
/** Instruction file inside the vendored skill directory. */
export const SKILL_INSTRUCTION_FILE = 'SKILL.md';
/** Discovery source bucket reported for the vendored skill. */
export const REVIEW_SKILL_SOURCE = 'bundled';
/** Routing description used when the vendored frontmatter has none. */
const FALLBACK_DESCRIPTION = 'Multi-perspective academic paper review with dynamic reviewer personas: a 5-seat, '
    + 'role-separated peer-review panel (Journal-Fit/EIC plus three peer-review roles plus a '
    + "Devil's Advocate), an editorial decision letter, and a revision roadmap.";
/** Routing hint shown next to the description. */
const WHEN_TO_USE = 'Use to review a manuscript (.md/.tex/.txt) as a journal referee panel, to produce an '
    + 'editorial decision letter and revision roadmap, or to stress-test a paper argument.';
/**
 * The plugin package root resolved from this module's own URL (lib/skills.js).
 * @returns absolute package root directory.
 */
export function packageRoot() {
    return resolve(dirname(fileURLToPath(import.meta.url)), '..');
}
/**
 * Default vendored skill directory: <package root>/vendor/academic-paper-reviewer.
 * @returns absolute directory path.
 */
export function defaultResourceBasePath() {
    return join(packageRoot(), 'vendor', 'academic-paper-reviewer');
}
/**
 * Split a Markdown skill file into its YAML frontmatter fields and body.
 * The parser is deliberately minimal: the vendored frontmatter is a flat map
 * of scalars, and the body is passed through byte-for-byte.
 * @param text - raw file content.
 * @returns parsed frontmatter fields plus the body.
 */
export function parseSkillDocument(text) {
    const normalized = text.replace(/^\uFEFF/, '');
    if (!normalized.startsWith('---'))
        return { body: normalized };
    const end = normalized.indexOf('\n---', 3);
    if (end === -1)
        return { body: normalized };
    const frontmatter = normalized.slice(3, end);
    const bodyStart = normalized.indexOf('\n', end + 1);
    const body = bodyStart === -1 ? '' : normalized.slice(bodyStart + 1);
    let name;
    let description;
    for (const line of frontmatter.split(/\r?\n/)) {
        const match = /^(name|description):\s*(.*)$/.exec(line);
        if (match === null)
            continue;
        const value = unquote(match[2] ?? '');
        if (match[1] === 'name')
            name = value;
        else
            description = value;
    }
    return {
        ...(name === undefined ? {} : { name }),
        ...(description === undefined ? {} : { description }),
        body,
    };
}
/** Strip one layer of surrounding quotes from a frontmatter scalar. */
function unquote(value) {
    const trimmed = value.trim();
    if (trimmed.length >= 2) {
        const first = trimmed.charAt(0);
        const last = trimmed.charAt(trimmed.length - 1);
        if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
            return trimmed.slice(1, -1).replace(/\\"/g, '"');
        }
    }
    return trimmed;
}
/** Read-only skill provider over one vendored skill directory. */
export class VendoredReviewSkillProvider {
    /** Provider name used by the skill registry. */
    name;
    /** Absolute vendored skill directory. */
    resourceBasePath;
    /** Advertised skill name. */
    skillName;
    /** Precedence rank. */
    rank;
    /** Registration lifecycle, borrowed from the registry. */
    control;
    constructor(config, control) {
        this.name = config.providerName;
        this.resourceBasePath = resolve(config.resourceBasePath);
        this.skillName = config.skillName ?? REVIEW_SKILL_NAME;
        this.rank = config.rank ?? REVIEW_SKILL_RANK;
        this.control = control;
    }
    /** Absolute path of the vendored instruction file. */
    get instructionPath() {
        return join(this.resourceBasePath, SKILL_INSTRUCTION_FILE);
    }
    /** Resource base advertised to the model for relative references. */
    get resourceBase() {
        return { kind: 'directory', path: this.resourceBasePath };
    }
    /**
     * List the vendored skill.
     * A missing instruction file is a hard discovery failure rather than a silent
     * empty catalog, so a broken install is visible instead of invisible.
     * @param options - lookup options; the signal cancels discovery.
     * @returns one candidate.
     */
    async list(options = {}) {
        if (options.signal?.aborted === true)
            throw new Error('skill discovery aborted');
        const raw = await readFile(this.instructionPath, 'utf8');
        const document = parseSkillDocument(raw);
        const candidate = {
            name: this.skillName,
            description: candidateDescription(document),
            whenToUse: WHEN_TO_USE,
            invocation: { modelInvocable: true, userInvocable: true },
            source: REVIEW_SKILL_SOURCE,
            provider: this.name,
            rank: this.rank,
            resourceBase: this.resourceBase,
            path: this.instructionPath,
            locator: { path: this.instructionPath, directory: this.resourceBasePath },
        };
        return [candidate];
    }
    /**
     * Load the vendored skill body.
     * @param candidate - candidate previously returned by this provider.
     * @param options - lookup options; the signal cancels the read.
     * @returns the complete skill definition, or undefined if the file vanished.
     */
    async get(candidate, options = {}) {
        if (options.signal?.aborted === true)
            throw new Error('skill load aborted');
        const locator = candidate.locator;
        const path = typeof locator?.path === 'string' ? locator.path : this.instructionPath;
        let raw;
        try {
            raw = await readFile(path, 'utf8');
        }
        catch (error) {
            if (error.code === 'ENOENT')
                return undefined;
            throw error;
        }
        void this.control;
        const document = parseSkillDocument(raw);
        return {
            name: this.skillName,
            description: candidateDescription(document),
            whenToUse: WHEN_TO_USE,
            invocation: { modelInvocable: true, userInvocable: true },
            source: REVIEW_SKILL_SOURCE,
            provider: this.name,
            resourceBase: this.resourceBase,
            path,
            content: document.body,
            metadata: {
                upstreamSkill: this.skillName,
                upstreamSkillVersion: '1.11.1',
                upstreamCommit: '1ec249df98728682dfbbdfb940a658338bfd6f80',
                license: 'CC BY-NC 4.0',
                unofficialPort: true,
                vendorDirectory: this.resourceBasePath,
            },
        };
    }
}
/** Choose the advertised description, keeping the upstream trigger list. */
function candidateDescription(document) {
    const description = document.description?.trim() ?? '';
    return description === '' ? FALLBACK_DESCRIPTION : description;
}
/**
 * Register the vendored reviewer skill provider on ctx.skills.
 * @param ctx - plugin context (injects skills).
 * @param config - resolved provider configuration.
 * @returns the disposer that unregisters the provider.
 */
export function registerReviewSkillProvider(ctx, config) {
    return ctx.skills.registerProvider(control => new VendoredReviewSkillProvider(config, control));
}
