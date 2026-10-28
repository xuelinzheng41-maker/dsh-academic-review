/**
 * Read-only web surface for the Academic Review panel.
 *
 * Three GET routes under /plugins/dsh-academic-skills/reviews, authenticated by
 * the host connection gate (same wrapper the AgentTeams plugin uses). No POST,
 * no mutation: the only bytes ever read live under
 * <workspace>/<stateDir>/<review_id>/, and review ids are validated against a
 * strict character class so a crafted URL cannot traverse out of the review
 * root.
 *
 *   GET .../reviews            -> { reviews: ReviewSummary[] }
 *   GET .../reviews/<id>       -> ReviewSummary (404 when unknown)
 *   GET .../reviews/<id>/report -> { markdown } (409 { error } when not written yet)
 *
 * @module dsh-academic-skills/web
 */
import type { Context } from '@deepseek-ai/cordis';
import { SEAT_IDS, type ReviewState, type SeatId, type Severity } from './state.ts';
/** Route prefix shared by every panel data route. */
export declare const REVIEWS_ROUTE_ROOT = "/plugins/dsh-academic-skills/reviews";
/** Per-seat summary served to the panel. */
export interface SeatSummary {
    seat_id: SeatId;
    status: string;
    findings_open: number;
    findings_by_severity: Record<Severity, number>;
}
/** One review as the panel renders it. */
export interface ReviewSummary {
    review_id: string;
    paper_name: string;
    mode: string;
    status: string;
    seats: SeatSummary[];
    updated_at: string;
    pending_checkpoint: boolean;
}
/** Resolved web-route configuration. */
export interface AcademicReviewWebConfig {
    /** Review-state directory name under the workspace (default .academic-review). */
    readonly stateDir: string;
    /** Optional fixed workspace root; otherwise the process cwd. */
    readonly workspaceRoot?: string;
}
/** Collapse one review record to the panel summary. */
export declare function summarizeReview(state: ReviewState): ReviewSummary;
/**
 * Register the three read-only review routes on the host web server.
 *
 * Registration is deferred until the webServer (or legacy httpServer) service
 * appears, matching the AgentTeams assembly pattern; a headless composition
 * that never provides one simply never routes.
 *
 * @param ctx - plugin context.
 * @param config - state-dir/workspace configuration shared with the tools.
 */
export declare function registerAcademicReviewWebRoutes(ctx: Context, config: AcademicReviewWebConfig): void;
/** Seat ids exported for the panel contract test. */
export { SEAT_IDS };
