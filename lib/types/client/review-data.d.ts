/**
 * Read-only data adapter between the Academic Review panel and the plugin's
 * review-state web surface (docs/PORT_SPEC.md section 3). Every read goes
 * through the three authenticated GET routes registered by src/web.ts; the
 * browser never touches the filesystem and there are no mutation calls.
 *
 * @module dsh-academic-review/client
 */
/** Route prefix served by the plugin's web surface. */
export declare const REVIEWS_API_ROOT = "/plugins/dsh-academic-review/reviews";
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
    pending_checkpoint: boolean;
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
