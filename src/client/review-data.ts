/**
 * Read-only data adapter between the Academic Review panel and the plugin's
 * review-state web surface (docs/PORT_SPEC.md section 3). Every read goes
 * through the three authenticated GET routes registered by src/web.ts; the
 * browser never touches the filesystem and there are no mutation calls.
 *
 * @module dsh-academic-review/client
 */

/** Route prefix served by the plugin's web surface. */
export const REVIEWS_API_ROOT = '/plugins/dsh-academic-review/reviews'

/** The five Phase 1 seat ids, in panel order. */
export const SEAT_IDS = ['eic', 'methodology', 'domain', 'perspective', 'da'] as const

/** Per-seat summary row served by the backend. */
export interface SeatSummary {
  seat_id: string
  status: string
  findings_open: number
  findings_by_severity: Record<string, number>
}

/** One review summary served by the backend. */
export interface ReviewSummary {
  review_id: string
  paper_name: string
  mode: string
  status: string
  seats: SeatSummary[]
  updated_at: string
  pending_checkpoint: boolean
}

/** Outcome of a reviews-list fetch. */
export type ReviewsLoad =
  | { kind: 'ok'; reviews: ReviewSummary[] }
  | { kind: 'unauthorized' }
  | { kind: 'error'; message: string }

/** Outcome of a single-review fetch. */
export type ReviewLoad =
  | { kind: 'ok'; review: ReviewSummary }
  | { kind: 'not-found' }
  | { kind: 'unauthorized' }
  | { kind: 'error'; message: string }

/** Outcome of a report fetch. */
export type ReportLoad =
  | { kind: 'ok'; markdown: string }
  | { kind: 'not-ready' }
  | { kind: 'not-found' }
  | { kind: 'unauthorized' }
  | { kind: 'error'; message: string }

/** Narrow an unknown thrown value to a message. */
function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/**
 * Fetch every review under the workspace's state root.
 * @returns classified load outcome; never throws.
 */
export async function fetchReviews(): Promise<ReviewsLoad> {
  try {
    const response = await fetch(REVIEWS_API_ROOT, { headers: { accept: 'application/json' } })
    if (response.status === 401 || response.status === 403) return { kind: 'unauthorized' }
    if (response.status === 503) return { kind: 'unauthorized' }
    if (!response.ok) return { kind: 'error', message: 'HTTP ' + String(response.status) }
    const body: unknown = await response.json()
    const reviews = (body as { reviews?: unknown })?.reviews
    if (!Array.isArray(reviews)) return { kind: 'error', message: 'malformed response' }
    return { kind: 'ok', reviews: reviews as ReviewSummary[] }
  } catch (error) {
    return { kind: 'error', message: messageOf(error) }
  }
}

/**
 * Fetch one review's summary.
 * @param reviewId - review id (rev-YYYYMMDD-8hex).
 */
export async function fetchReview(reviewId: string): Promise<ReviewLoad> {
  try {
    const response = await fetch(REVIEWS_API_ROOT + '/' + encodeURIComponent(reviewId), { headers: { accept: 'application/json' } })
    if (response.status === 401 || response.status === 403 || response.status === 503) return { kind: 'unauthorized' }
    if (response.status === 404) return { kind: 'not-found' }
    if (!response.ok) return { kind: 'error', message: 'HTTP ' + String(response.status) }
    const body: unknown = await response.json()
    if (typeof body !== 'object' || body === null) return { kind: 'error', message: 'malformed response' }
    return { kind: 'ok', review: body as ReviewSummary }
  } catch (error) {
    return { kind: 'error', message: messageOf(error) }
  }
}

/**
 * Fetch the editorial decision letter markdown for one review.
 * @param reviewId - review id.
 */
export async function fetchReport(reviewId: string): Promise<ReportLoad> {
  try {
    const response = await fetch(REVIEWS_API_ROOT + '/' + encodeURIComponent(reviewId) + '/report', { headers: { accept: 'application/json' } })
    if (response.status === 401 || response.status === 403 || response.status === 503) return { kind: 'unauthorized' }
    if (response.status === 404) return { kind: 'not-found' }
    if (response.status === 409) return { kind: 'not-ready' }
    if (!response.ok) return { kind: 'error', message: 'HTTP ' + String(response.status) }
    const body: unknown = await response.json()
    const markdown = (body as { markdown?: unknown })?.markdown
    if (typeof markdown !== 'string') return { kind: 'error', message: 'malformed response' }
    return { kind: 'ok', markdown }
  } catch (error) {
    return { kind: 'error', message: messageOf(error) }
  }
}

/**
 * Open the decision letter in a new browser tab (JSON body converted to a
 * plain-text document); fails soft when the report is not on disk yet.
 * @param reviewId - review id.
 */
export async function openReport(reviewId: string): Promise<ReportLoad> {
  const load = await fetchReport(reviewId)
  if (load.kind !== 'ok') return load
  const blob = new Blob([load.markdown], { type: 'text/markdown;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const opened = window.open(url, '_blank', 'noopener')
  if (opened === null) {
    // Popups can be blocked; fall back to navigating the current tab.
    window.location.assign(url)
  }
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000)
  return load
}
