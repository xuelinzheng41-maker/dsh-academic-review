/**
 * Model-facing review tools for the dsh-academic-review plugin.
 *
 * Five tools, all prefixed academic_review_, mirroring the tool API fixed in
 * docs/PORT_SPEC.md section 3:
 *
 * - academic_review_create  - pin a manuscript (.md/.tex/.txt) and open a review
 * - academic_review_status  - report status, per-seat state, and pending checkpoint
 * - academic_review_confirm - attach the field analysis and record human
 *                             checkpoint 1 (the only path out of 'created')
 * - academic_review_submit  - commit one seat report (immutable once committed)
 * - academic_review_report  - synthesize the decision letter and roadmap, then
 *                             require an explicit human approval flag
 *
 * The tool layer only validates and presents; every state transition, schema
 * check, and atomic write lives in ./state.ts so tests exercise the same code
 * the model does.
 *
 * @module dsh-academic-review/tools
 */
import type { Context } from '@deepseek-ai/cordis';
import { type ReviewStatusSummary, type SeatId, type Verdict } from './state.ts';
/** Resolved tool configuration. */
export interface AcademicReviewToolsConfig {
    /** Review-state directory name under the workspace (default .academic-review). */
    readonly stateDir: string;
    /** Optional fixed workspace root; otherwise the calling session cwd is used. */
    readonly workspaceRoot?: string;
    /** Oversize warning threshold in bytes. */
    readonly maxPaperBytes?: number;
    /** Vendored upstream skill version recorded per review. */
    readonly upstreamSkillVersion?: string;
    /** Vendored upstream commit recorded per review. */
    readonly upstreamCommit?: string;
}
/**
 * Register the five academic_review_* tools into the shared tools registry.
 * @param ctx - plugin context (injects tools).
 * @param config - resolved tool configuration.
 */
export declare function registerAcademicReviewTools(ctx: Context, config: AcademicReviewToolsConfig): void;
/** Wire shape of one status tool result, used by the shared renderer. */
interface StatusOutput {
    review_id: string;
    status: string;
    mode: string;
    paper_path: string;
    paper_sha256: string;
    seats: {
        seat_id: string;
        role: string;
        status: string;
        verdict?: string;
    }[];
    submitted_seats: string[];
    missing_seats: string[];
    decision?: string;
    pending_checkpoint?: string;
    advisory_checks: unknown;
    review_dir: string;
    warnings: string[];
}
/**
 * Render a status result as one model-facing text block.
 * @param value - validated status output.
 * @returns rendered text.
 */
export declare function renderStatusText(value: StatusOutput): string;
/** Seat metadata exported for the prompt pack (T6) and the GUI panel (T3). */
export declare const REVIEW_SEAT_METADATA: readonly {
    seat_id: SeatId;
    role_marker: string;
    role_name: string;
    agent_file: string;
}[];
/** Verdict union re-exported for consumers that only import the tool layer. */
export type { Verdict, ReviewStatusSummary };
