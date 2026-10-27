/** `academicReview` namespace dictionaries for the Academic Review panel. */
/** Dictionary namespace owned by the dsh-academic-review client plugin. */
export declare const ACADEMIC_REVIEW_LOCALE_NAMESPACE = "academicReview";
/** Simplified Chinese dictionary (the key-set source of truth). */
export declare const zh: {
    'panel.title': string;
    'panel.description': string;
    'panel.emptyTitle': string;
    'panel.emptyBody': string;
    'panel.loading': string;
    'panel.error': string;
    'panel.retry': string;
    'panel.refresh': string;
    'review.mode': string;
    'review.status': string;
    'review.updated': string;
    'review.checkpoint': string;
    'review.checkpointHint': string;
    'review.openReport': string;
    'review.noReport': string;
    'seat.heading': string;
    'seat.role': string;
    'seat.status': string;
    'seat.findings': string;
    'seat.editorialSynthesizer': string;
    'seat.id.eic': string;
    'seat.id.methodology': string;
    'seat.id.domain': string;
    'seat.id.perspective': string;
    'seat.id.da': string;
    'seat.verdict': string;
    'severity.critical': string;
    'severity.major': string;
    'severity.minor': string;
    'severity.comment': string;
    'status.created': string;
    'status.panel_configured': string;
    'status.awaiting_panel_confirmation': string;
    'status.in_review': string;
    'status.all_submitted': string;
    'status.awaiting_synthesis_approval': string;
    'status.report_ready': string;
    'status.abandoned': string;
    'seatStatus.pending': string;
    'seatStatus.dispatched': string;
    'seatStatus.submitted': string;
    'seatStatus.failed': string;
    'verdict.accept': string;
    'verdict.minor_revision': string;
    'verdict.major_revision': string;
    'verdict.reject': string;
    'verdict.none': string;
    'error.notFound': string;
    'error.reportNotReady': string;
    'error.loadFailed': string;
};
/** Namespace key union. */
export type AcademicReviewLocaleKey = keyof typeof zh;
/** English dictionary, key-complete against the Chinese source set. */
export declare const en: Record<AcademicReviewLocaleKey, string>;
