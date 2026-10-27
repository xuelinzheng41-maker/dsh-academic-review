/**
 * Read-only data adapter between the Academic Review panel and the plugin's
 * review-state web surface (docs/PORT_SPEC.md section 3). Every read goes
 * through the three authenticated GET routes registered by src/web.ts; the
 * browser never touches the filesystem and there are no mutation calls.
 *
 * @module dsh-academic-review/client
 */
/** Route prefix served by the plugin's web surface. */
export const REVIEWS_API_ROOT = '/plugins/dsh-academic-review/reviews';
/** The five Phase 1 seat ids, in panel order. */
export const SEAT_IDS = ['eic', 'methodology', 'domain', 'perspective', 'da'];
/** Narrow an unknown thrown value to a message. */
function messageOf(error) {
    return error instanceof Error ? error.message : String(error);
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
