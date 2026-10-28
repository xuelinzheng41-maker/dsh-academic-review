/**
 * dsh-academic-skills: an unofficial DSH port of the Academic Research Skills
 * skill "academic-paper-reviewer" (Phase 1: reviewer only).
 *
 * The plugin registers two contributions into the host composition:
 *
 * 1. a skill provider (ctx.skills) that advertises and loads every vendored
 *    upstream skill text unmodified from vendor/ (today academic-paper-reviewer
 *    and deep-research), each with its own absolute resource base;
 * 2. five review-state tools (ctx.tools): academic_review_create,
 *    academic_review_status, academic_review_confirm, academic_review_submit,
 *    academic_review_report;
 * 3. two human slash commands (ctx.commands, registered lazily): /ars-review
 *    and /ars-review-status, thin adapters over the same ReviewStore.
 *
 * State, schema validation, and every lifecycle guard live in ./state.ts;
 * the vendored tree is read-only input. Human checkpoints (panel confirmation,
 * report approval) are enforced by the state machine and reached only through
 * academic_review_confirm and academic_review_report, so no unattended
 * create-to-report run can exist.
 *
 * Installation (bundle):
 *   dsh plugin --profile <name> add <this package or a local path>
 *
 * @module dsh-academic-skills
 */
import { resolve } from 'node:path';
import z from '@deepseek-ai/schemastery';
import { defaultVendorBasePath, registerReviewSkillProvider, resolveSkillSelection, } from "./skills.js";
import { registerAcademicReviewCommands } from "./commands.js";
import { registerAcademicReviewTools } from "./tools.js";
import { registerAcademicReviewWebRoutes } from "./web.js";
/** Cordis plugin name. */
export const name = 'academic-review';
/**
 * Required host services: the skill registry and the tool registry.
 *
 * The command registry is deliberately NOT here: the two slash commands are a
 * convenience surface, so they attach lazily when `commands` is composed and a
 * headless composition still mounts the tools and the skill.
 */
export const inject = ['skills', 'tools'];
/** Configuration schema applied by the host composition. */
export const Config = z.object({
    stateDir: z.string().default('.academic-review'),
    skillProviderName: z.string().default('academic-review'),
    vendorBasePath: z.string(),
    skills: z.array(z.string()),
    workspaceRoot: z.string(),
    maxPaperBytes: z.number().default(1024 * 1024),
    upstreamSkillVersion: z.string().default('1.11.1'),
    upstreamCommit: z.string().default('1ec249df98728682dfbbdfb940a658338bfd6f80'),
});
/**
 * Mount the skill provider and the review tools.
 * @param ctx - plugin context (injects skills and tools).
 * @param config - plugin configuration from cordis.patch.yml.
 */
export function apply(ctx, config = {}) {
    const stateDir = trimmed(config.stateDir) ?? '.academic-review';
    const providerName = trimmed(config.skillProviderName) ?? 'academic-review';
    const vendorBasePath = trimmed(config.vendorBasePath) === undefined
        ? defaultVendorBasePath()
        : resolve(trimmed(config.vendorBasePath));
    // Resolve the served set here as well so the mount log names exactly what the
    // provider will advertise; an unknown configured name throws right here.
    const requestedSkills = config.skills === undefined ? undefined : [...config.skills];
    const skillNames = resolveSkillSelection(vendorBasePath, requestedSkills);
    registerReviewSkillProvider(ctx, {
        providerName,
        vendorBasePath,
        ...(requestedSkills === undefined ? {} : { skills: requestedSkills }),
    });
    // One resolved binding feeds the tools and the slash commands, so both
    // address exactly the same review root and the same state layer.
    const reviewBinding = {
        stateDir,
        ...(trimmed(config.workspaceRoot) === undefined ? {} : { workspaceRoot: resolve(trimmed(config.workspaceRoot)) }),
        ...(config.maxPaperBytes === undefined ? {} : { maxPaperBytes: config.maxPaperBytes }),
        ...(trimmed(config.upstreamSkillVersion) === undefined ? {} : { upstreamSkillVersion: trimmed(config.upstreamSkillVersion) }),
        ...(trimmed(config.upstreamCommit) === undefined ? {} : { upstreamCommit: trimmed(config.upstreamCommit) }),
    };
    registerAcademicReviewTools(ctx, reviewBinding);
    // /ars-review and /ars-review-status (no business logic of their own).
    registerAcademicReviewCommands(ctx, reviewBinding);
    // Read-only panel data surface (three GET routes under /plugins/dsh-academic-skills/reviews).
    registerAcademicReviewWebRoutes(ctx, { stateDir, ...(trimmed(config.workspaceRoot) === undefined ? {} : { workspaceRoot: resolve(trimmed(config.workspaceRoot)) }) });
    ctx.logger.info('academic-review: ' + String(skillNames.length) + ' skill(s) served from ' + vendorBasePath
        + ' [' + skillNames.join(', ') + ']; review state under <workspace>/' + stateDir + '/<review_id>');
}
/** Trim an optional string, treating blank as absent. */
function trimmed(value) {
    if (value === undefined)
        return undefined;
    const next = value.trim();
    return next === '' ? undefined : next;
}
export { ReviewStore, SEAT_DEFINITIONS, SEAT_IDS, REVIEW_STATUSES } from "./state.js";
export { REVIEW_SEAT_METADATA } from "./tools.js";
export { summarizeReview, REVIEWS_ROUTE_ROOT } from "./web.js";
export { DEEP_RESEARCH_SKILL_NAME, REVIEW_SKILL_NAME, REVIEW_SKILL_RANK, defaultResourceBasePath, defaultVendorBasePath, discoverVendoredSkills, skillResourceBasePath, } from "./skills.js";
export { REVIEW_COMMAND, REVIEW_COMMAND_HINT, REVIEW_STATUS_COMMAND, REVIEW_STATUS_COMMAND_HINT, registerAcademicReviewCommands, } from "./commands.js";
