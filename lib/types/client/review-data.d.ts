/**
 * Read-only data adapter between the Academic Review panel and the plugin's
 * review-state web surface (docs/PORT_SPEC.md section 3). Every read goes
 * through the three authenticated GET routes registered by src/web.ts; the
 * browser never touches the filesystem and there are no mutation calls.
 *
 * @module dsh-academic-skills/client
 */
/** Route prefix served by the plugin's web surface. */
export declare const REVIEWS_API_ROOT = "/plugins/dsh-academic-skills/reviews";
/** The five Phase 1 seat ids, in panel order. */
export declare const SEAT_IDS: readonly ["eic", "methodology", "domain", "perspective", "da"];
/** Per-seat summary row served by the backend. */
export interface SeatSummary {
    seat_id: string;
    status: string;
    findings_open: number;
    findings_by_severity: Record<string, number>;
}
/** One review summary served by the backend. */
export interface ReviewSummary {
    review_id: string;
    paper_name: string;
    mode: string;
    status: string;
    seats: SeatSummary[];
    updated_at: string;
    /**
     * Checkpoint the review is waiting on. The backend currently serves a
     * boolean; the string form (the checkpoint name used by
     * academic_review_status) is accepted too so a finer-grained server needs no
     * client change. Absent means "derive it from the status".
     */
    pending_checkpoint?: boolean | string | null;
}
/** Outcome of a reviews-list fetch. */
export type ReviewsLoad = {
    kind: 'ok';
    reviews: ReviewSummary[];
} | {
    kind: 'unauthorized';
} | {
    kind: 'error';
    message: string;
};
/** Outcome of a single-review fetch. */
export type ReviewLoad = {
    kind: 'ok';
    review: ReviewSummary;
} | {
    kind: 'not-found';
} | {
    kind: 'unauthorized';
} | {
    kind: 'error';
    message: string;
};
/** Outcome of a report fetch. */
export type ReportLoad = {
    kind: 'ok';
    markdown: string;
} | {
    kind: 'not-ready';
} | {
    kind: 'not-found';
} | {
    kind: 'unauthorized';
} | {
    kind: 'error';
    message: string;
};
/** The three human checkpoints the review state machine reports. */
export declare const REVIEW_CHECKPOINTS: readonly ["field_analysis_attachment", "panel_confirmation", "report_approval"];
/** One human checkpoint name. */
export type ReviewCheckpoint = (typeof REVIEW_CHECKPOINTS)[number];
/**
 * The checkpoint one review is waiting on, or null when it is not blocked on a
 * human. A string `pending_checkpoint` from the server wins; otherwise the
 * status decides, so the panel still shows the right card against a backend
 * that only serves a boolean.
 * @param review - review summary.
 * @returns checkpoint name or null.
 */
export declare function checkpointOf(review: Pick<ReviewSummary, 'status' | 'pending_checkpoint'>): ReviewCheckpoint | null;
/** What the model must call next: the exact call text plus its caveats. */
export interface NextCall {
    /** Copy-ready call text naming the exact tool and arguments. */
    readonly call: string;
    /** Whether every Devil's Advocate CRITICAL finding must be adjudicated first. */
    readonly requiresDevilsAdvocateAdjudication: boolean;
}
/**
 * The exact next call that clears one checkpoint.
 *
 * The panel never performs it: the text is shown so the user can hand it to
 * the model in the session, which keeps this surface strictly read-only.
 *
 * @param review - review summary (id plus seats, for the card count).
 * @param checkpoint - checkpoint being reported.
 * @returns exact call text and its requirement flags.
 */
export declare function nextCallFor(review: Pick<ReviewSummary, 'review_id' | 'seats'>, checkpoint: ReviewCheckpoint): NextCall;
/**
 * Fetch every review under the workspace's state root.
 * @returns classified load outcome; never throws.
 */
export declare function fetchReviews(): Promise<ReviewsLoad>;
/**
 * Fetch one review's summary.
 * @param reviewId - review id (rev-YYYYMMDD-8hex).
 */
export declare function fetchReview(reviewId: string): Promise<ReviewLoad>;
/**
 * Fetch the editorial decision letter markdown for one review.
 * @param reviewId - review id.
 */
export declare function fetchReport(reviewId: string): Promise<ReportLoad>;
/**
 * Open the decision letter in a new browser tab (JSON body converted to a
 * plain-text document); fails soft when the report is not on disk yet.
 * @param reviewId - review id.
 */
export declare function openReport(reviewId: string): Promise<ReportLoad>;
