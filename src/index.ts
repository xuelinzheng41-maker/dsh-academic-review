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

import { resolve } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
// Declaration merges make ctx.skills and ctx.tools visible.
import type {} from '@deepseek-ai/dsh-skill'
import type {} from '@deepseek-ai/dsh-tools'
import {
  REVIEW_SKILL_NAME,
  defaultResourceBasePath,
  registerReviewSkillProvider,
} from './skills.ts'
import { registerAcademicReviewTools } from './tools.ts'
import { registerAcademicReviewWebRoutes } from './web.ts'

/** Cordis plugin name. */
export const name = 'academic-review'

/** Required host services: the skill registry and the tool registry. */
export const inject = ['skills', 'tools']

/** Plugin configuration. */
export interface Config {
  /** Review-state directory under the session workspace (default .academic-review). */
  stateDir?: string
  /** Provider name registered on the skill registry (default academic-review). */
  skillProviderName?: string
  /**
   * Absolute directory of the vendored skill. Defaults to
   * <package root>/vendor/academic-paper-reviewer and is normally left unset.
   */
  resourceBasePath?: string
  /** Fixed workspace root for review state; defaults to the calling session cwd. */
  workspaceRoot?: string
  /** Manuscript size above which seats are told to read in sections (default 1 MiB). */
  maxPaperBytes?: number
  /** Vendored upstream skill version recorded in each review. */
  upstreamSkillVersion?: string
  /** Vendored upstream commit recorded in each review. */
  upstreamCommit?: string
}

/** Configuration schema applied by the host composition. */
export const Config = z.object({
  stateDir: z.string().default('.academic-review'),
  skillProviderName: z.string().default('academic-review'),
  resourceBasePath: z.string(),
  workspaceRoot: z.string(),
  maxPaperBytes: z.number().default(1024 * 1024),
  upstreamSkillVersion: z.string().default('1.11.1'),
  upstreamCommit: z.string().default('1ec249df98728682dfbbdfb940a658338bfd6f80'),
})

/**
 * Mount the skill provider and the review tools.
 * @param ctx - plugin context (injects skills and tools).
 * @param config - plugin configuration from cordis.patch.yml.
 */
export function apply(ctx: Context, config: Config = {}): void {
  const stateDir = trimmed(config.stateDir) ?? '.academic-review'
  const providerName = trimmed(config.skillProviderName) ?? 'academic-review'
  const resourceBasePath = trimmed(config.resourceBasePath) === undefined
    ? defaultResourceBasePath()
    : resolve(trimmed(config.resourceBasePath) as string)
  registerReviewSkillProvider(ctx, { providerName, resourceBasePath })
  registerAcademicReviewTools(ctx, {
    stateDir,
    ...(trimmed(config.workspaceRoot) === undefined ? {} : { workspaceRoot: resolve(trimmed(config.workspaceRoot) as string) }),
    ...(config.maxPaperBytes === undefined ? {} : { maxPaperBytes: config.maxPaperBytes }),
    ...(trimmed(config.upstreamSkillVersion) === undefined ? {} : { upstreamSkillVersion: trimmed(config.upstreamSkillVersion) as string }),
    ...(trimmed(config.upstreamCommit) === undefined ? {} : { upstreamCommit: trimmed(config.upstreamCommit) as string }),
  })
  // Read-only panel data surface (three GET routes under /plugins/dsh-academic-review/reviews).
  registerAcademicReviewWebRoutes(ctx, { stateDir, ...(trimmed(config.workspaceRoot) === undefined ? {} : { workspaceRoot: resolve(trimmed(config.workspaceRoot) as string) }) })
  ctx.logger.info('academic-review: skill "' + REVIEW_SKILL_NAME + '" served from ' + resourceBasePath
    + '; review state under <workspace>/' + stateDir + '/<review_id>')
}

/** Trim an optional string, treating blank as absent. */
function trimmed(value: string | undefined): string | undefined {
  if (value === undefined) return undefined
  const next = value.trim()
  return next === '' ? undefined : next
}

export { ReviewStore, SEAT_DEFINITIONS, SEAT_IDS, REVIEW_STATUSES } from './state.ts'
export type {
  ReviewState,
  SeatId,
  SeatReport,
  ReviewStatus,
  ReviewMode,
  Verdict,
  Severity,
} from './state.ts'
export { REVIEW_SEAT_METADATA } from './tools.ts'
export { summarizeReview, REVIEWS_ROUTE_ROOT } from './web.ts'
export type { ReviewSummary, SeatSummary } from './web.ts'
export { REVIEW_SKILL_NAME, REVIEW_SKILL_RANK } from './skills.ts'
