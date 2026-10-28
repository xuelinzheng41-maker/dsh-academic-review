/**
 * Read-only data adapter between the Academic Review panel and the plugin's
 * review-state web surface (docs/PORT_SPEC.md section 3). Every read goes
 * through the three authenticated GET routes registered by src/web.ts; the
 * browser never touches the filesystem and there are no mutation calls.
 *
 * @module dsh-academic-skills/client
 */
/** Route prefix served by the plugin's web surface. */
export const REVIEWS_API_ROOT = '/plugins/dsh-academic-skills/reviews';
/** The five Phase 1 seat ids, in panel order. */
export const SEAT_IDS = ['eic', 'methodology', 'domain', 'perspective', 'da'];
/** The three human checkpoints the review state machine reports. */
export const REVIEW_CHECKPOINTS = [
    'field_analysis_attachment',
    'panel_confirmation',
    'report_approval',
];
/** Narrow an unknown thrown value to a message. */
function messageOf(error) {
    return error instanceof Error ? error.message : String(error);
}
/**
 * Checkpoint implied by a lifecycle status, or null when the review is not
 * waiting on a human (mirrors pendingCheckpointOf in src/state.ts).
 */
const CHECKPOINT_BY_STATUS = {
    created: 'field_analysis_attachment',
    panel_configured: 'field_analysis_attachment',
    awaiting_panel_confirmation: 'panel_confirmation',
    awaiting_synthesis_approval: 'report_approval',
};
/**
 * The checkpoint one review is waiting on, or null when it is not blocked on a
 * human. A string `pending_checkpoint` from the server wins; otherwise the
 * status decides, so the panel still shows the right card against a backend
 * that only serves a boolean.
 * @param review - review summary.
 * @returns checkpoint name or null.
 */
export function checkpointOf(review) {
    const declared = review.pending_checkpoint;
    if (typeof declared === 'string' && REVIEW_CHECKPOINTS.includes(declared)) {
        return declared;
    }
    return CHECKPOINT_BY_STATUS[review.status] ?? null;
}
/** Quote one argument value for the call text (JSON string form). */
function q(value) {
    return JSON.stringify(value);
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
export function nextCallFor(review, checkpoint) {
    const reviewId = q(review.review_id);
    switch (checkpoint) {
        case 'field_analysis_attachment': {
            const seats = review.seats
                .map(seat => seat.seat_id)
                .filter(seatId => seatId !== 'da');
            const cardSeats = seats.length > 0 ? seats : ['eic', 'methodology', 'domain', 'perspective'];
            const cards = cardSeats.map(seatId => '    { seat: ' + q(seatId)
                + ', identity: "<role identity>", expertise: "<expertise>", focus: "<review focus>" }');
            return {
                call: [
                    'academic_review_confirm({',
                    '  review_id: ' + reviewId + ',',
                    '  action: "attach",',
                    '  primary_discipline: "<primary discipline from the field analysis>",',
                    '  secondary_disciplines: ["<secondary discipline>"],',
                    '  research_paradigm: "<research paradigm>",',
                    '  methodology_type: "<methodology type>",',
                    '  target_journal_tier: "<target journal tier>",',
                    '  paper_maturity: "<paper maturity>",',
                    '  configuration_cards: [',
                    cards.join(',\n'),
                    '  ]',
                    '})',
                    '// then, once the user has seen and approved the cards:',
                    'academic_review_confirm({',
                    '  review_id: ' + reviewId + ',',
                    '  action: "confirm"',
                    '})',
                ].join('\n'),
                requiresDevilsAdvocateAdjudication: false,
            };
        }
        case 'panel_confirmation':
            return {
                call: [
                    'academic_review_confirm({',
                    '  review_id: ' + reviewId + ',',
                    '  action: "confirm"',
                    '  // configuration_cards: [ ... ]  // optional, only when the user edits a card',
                    '})',
                ].join('\n'),
                requiresDevilsAdvocateAdjudication: false,
            };
        case 'report_approval':
            return {
                call: [
                    'academic_review_report({',
                    '  review_id: ' + reviewId + ',',
                    '  approve: true,',
                    '  da_adjudications: [',
                    '    {',
                    '      finding_id: "<Devil\'s Advocate CRITICAL finding id>",',
                    '      outcome: "validated",  // validated | rejected | unresolved',
                    '      rationale: "<why the finding holds, or why it does not>"',
                    '    }',
                    '  ]',
                    '})',
                ].join('\n'),
                requiresDevilsAdvocateAdjudication: true,
            };
    }
}
/**
 * Fetch every review under the workspace's state root.
 * @returns classified load outcome; never throws.
 */
export async function fetchReviews() {
    try {
        const response = await fetch(REVIEWS_API_ROOT, { headers: { accept: 'application/json' } });
        if (response.status === 401 || response.status === 403)
            return { kind: 'unauthorized' };
        if (response.status === 503)
            return { kind: 'unauthorized' };
        if (!response.ok)
            return { kind: 'error', message: 'HTTP ' + String(response.status) };
        const body = await response.json();
        const reviews = body?.reviews;
        if (!Array.isArray(reviews))
            return { kind: 'error', message: 'malformed response' };
        return { kind: 'ok', reviews: reviews };
    }
    catch (error) {
        return { kind: 'error', message: messageOf(error) };
    }
}
/**
 * Fetch one review's summary.
 * @param reviewId - review id (rev-YYYYMMDD-8hex).
 */
export async function fetchReview(reviewId) {
    try {
        const response = await fetch(REVIEWS_API_ROOT + '/' + encodeURIComponent(reviewId), { headers: { accept: 'application/json' } });
        if (response.status === 401 || response.status === 403 || response.status === 503)
            return { kind: 'unauthorized' };
        if (response.status === 404)
            return { kind: 'not-found' };
        if (!response.ok)
            return { kind: 'error', message: 'HTTP ' + String(response.status) };
        const body = await response.json();
        if (typeof body !== 'object' || body === null)
            return { kind: 'error', message: 'malformed response' };
        return { kind: 'ok', review: body };
    }
    catch (error) {
        return { kind: 'error', message: messageOf(error) };
    }
}
/**
 * Fetch the editorial decision letter markdown for one review.
 * @param reviewId - review id.
 */
export async function fetchReport(reviewId) {
    try {
        const response = await fetch(REVIEWS_API_ROOT + '/' + encodeURIComponent(reviewId) + '/report', { headers: { accept: 'application/json' } });
        if (response.status === 401 || response.status === 403 || response.status === 503)
            return { kind: 'unauthorized' };
        if (response.status === 404)
            return { kind: 'not-found' };
        if (response.status === 409)
            return { kind: 'not-ready' };
        if (!response.ok)
            return { kind: 'error', message: 'HTTP ' + String(response.status) };
        const body = await response.json();
        const markdown = body?.markdown;
        if (typeof markdown !== 'string')
            return { kind: 'error', message: 'malformed response' };
        return { kind: 'ok', markdown };
    }
    catch (error) {
        return { kind: 'error', message: messageOf(error) };
    }
}
/**
 * Open the decision letter in a new browser tab (JSON body converted to a
 * plain-text document); fails soft when the report is not on disk yet.
 * @param reviewId - review id.
 */
export async function openReport(reviewId) {
    const load = await fetchReport(reviewId);
    if (load.kind !== 'ok')
        return load;
    const blob = new Blob([load.markdown], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const opened = window.open(url, '_blank', 'noopener');
    if (opened === null) {
        // Popups can be blocked; fall back to navigating the current tab.
        window.location.assign(url);
    }
    window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
    return load;
}
