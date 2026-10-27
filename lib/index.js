/**
 * dsh-academic-review: an unofficial DSH port of the Academic Research Skills
 * skill "academic-paper-reviewer" (Phase 1: reviewer only).
 *
 * The plugin registers two contributions into the host composition:
 *
 * 1. a skill provider (ctx.skills) that advertises and loads the vendored
 *    upstream skill text unmodified from vendor/academic-paper-reviewer;
 * 2. five review-state tools (ctx.tools): academic_review_create,
 *    academic_review_status, academic_review_confirm, academic_review_submit,
 *    academic_review_report.
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
 * @module dsh-academic-review
 */
import { resolve } from 'node:path';
import z from '@deepseek-ai/schemastery';
import { REVIEW_SKILL_NAME, defaultResourceBasePath, registerReviewSkillProvider, } from "./skills.js";
import { registerAcademicReviewTools } from "./tools.js";
import { registerAcademicReviewWebRoutes } from "./web.js";
/** Cordis plugin name. */
export const name = 'academic-review';
/** Required host services: the skill registry and the tool registry. */
export const inject = ['skills', 'tools'];
/** Configuration schema applied by the host composition. */
export const Config = z.object({
    stateDir: z.string().default('.academic-review'),
    skillProviderName: z.string().default('academic-review'),
    resourceBasePath: z.string(),
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
    const resourceBasePath = trimmed(config.resourceBasePath) === undefined
        ? defaultResourceBasePath()
        : resolve(trimmed(config.resourceBasePath));
    registerReviewSkillProvider(ctx, { providerName, resourceBasePath });
    registerAcademicReviewTools(ctx, {
        stateDir,
        ...(trimmed(config.workspaceRoot) === undefined ? {} : { workspaceRoot: resolve(trimmed(config.workspaceRoot)) }),
        ...(config.maxPaperBytes === undefined ? {} : { maxPaperBytes: config.maxPaperBytes }),
        ...(trimmed(config.upstreamSkillVersion) === undefined ? {} : { upstreamSkillVersion: trimmed(config.upstreamSkillVersion) }),
        ...(trimmed(config.upstreamCommit) === undefined ? {} : { upstreamCommit: trimmed(config.upstreamCommit) }),
    });
    // Read-only panel data surface (three GET routes under /plugins/dsh-academic-review/reviews).
    registerAcademicReviewWebRoutes(ctx, { stateDir, ...(trimmed(config.workspaceRoot) === undefined ? {} : { workspaceRoot: resolve(trimmed(config.workspaceRoot)) }) });
    ctx.logger.info('academic-review: skill "' + REVIEW_SKILL_NAME + '" served from ' + resourceBasePath
        + '; review state under <workspace>/' + stateDir + '/<review_id>');
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
export { REVIEW_SKILL_NAME, REVIEW_SKILL_RANK } from "./skills.js";
