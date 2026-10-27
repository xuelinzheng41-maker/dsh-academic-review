/** Academic Review panel: review id, seats, findings tally, checkpoints. */
import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from 'react'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import { fetchReviews, openReport, SEAT_IDS, type ReviewSummary, type ReviewsLoad, type SeatSummary } from './review-data.ts'
import css from './AcademicReviewPanel.module.css'

/** Locale prop contract for the panel. */
export type AcademicReviewPanelProps = PropsLocale<'academicReview'>

/** Poll cadence while the panel is visible (ms). */
const POLL_MS = 10_000

/** Seats the synthesizer section stands in for (not a panel seat). */
const SYNTHESIS_STATUSES = new Set(['all_submitted', 'awaiting_synthesis_approval', 'report_ready'])

/** Stable empty list so effect deps cannot churn. */
const NO_REVIEWS: ReviewSummary[] = []

/** Small observable used to gate polling on document visibility. */
function visibilitySnapshot(): boolean {
  return typeof document === 'undefined' ? true : !document.hidden
}
function subscribeVisibility(onChange: () => void): () => void {
  if (typeof document === 'undefined') return () => {}
  document.addEventListener('visibilitychange', onChange)
  return () => document.removeEventListener('visibilitychange', onChange)
}

/** Translate helper type as synthesized by the slot framework. */
type Translate = PropsLocale<'academicReview'>['t']
type LooseTranslate = (key: string, values?: Record<string, string | number>) => string

/** Format the update timestamp in the viewer's locale, best effort. */
function formatTime(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return iso
  try {
    return date.toLocaleString()
  } catch {
    return iso
  }
}

/** One seat row: role name, status chip, findings tally. */
function SeatRow({ seat, t }: { seat: SeatSummary; t: LooseTranslate }) {
  const severity = seat.findings_by_severity ?? {}
  const tally = (['critical', 'major', 'minor', 'comment'] as const)
    .filter(key => (severity[key] ?? 0) > 0)
    .map(key => t('severity.' + key) + ' ' + String(severity[key]))
  return (
    <tr className={css.seatRow} data-seat={seat.seat_id} data-status={seat.status}>
      <td className={css.seatName}>{t('seat.id.' + seat.seat_id)}</td>
      <td><span className={css.statusChip} data-status={seat.status}>{t('seatStatus.' + seat.status)}</span></td>
      <td className={css.findings}>
        {seat.findings_open === 0
          ? <span className={css.muted}>0</span>
          : <>{String(seat.findings_open)}{tally.length > 0 ? <span className={css.muted}> · {tally.join(' / ')}</span> : null}</>}
      </td>
    </tr>
  )
}

/** One review card: header facts, seat table, synthesis row, report action. */
function ReviewCard({ review, t, onOpenReport, reportBusy }: {
  review: ReviewSummary
  t: Translate
  onOpenReport: (reviewId: string) => void
  reportBusy: boolean
}) {
  const translate = t as LooseTranslate
  const seats = useMemo(() => {
    const byId = new Map(review.seats.map(seat => [seat.seat_id, seat]))
    return SEAT_IDS.map(id => byId.get(id)).filter((seat): seat is SeatSummary => seat !== undefined)
  }, [review.seats])
  const reportReady = review.status === 'report_ready'
  return (
    <section className={css.reviewCard} data-review-id={review.review_id} data-status={review.status}>
      <header className={css.reviewHeader}>
        <h3 className={css.reviewTitle}>{review.review_id}</h3>
        <span className={css.statusChip} data-status={review.status}>{translate('status.' + review.status)}</span>
        {review.pending_checkpoint
          ? <span className={css.checkpointBadge} title={translate('review.checkpointHint')}>⏸ {translate('review.checkpoint')}</span>
          : null}
      </header>
      <dl className={css.facts}>
        <div><dt>{translate('review.mode')}</dt><dd>{review.mode}</dd></div>
        <div><dt>{translate('review.updated')}</dt><dd>{formatTime(review.updated_at)}</dd></div>
      </dl>
      <h4 className={css.seatHeading}>{translate('seat.heading')}</h4>
      <table className={css.seatTable}>
        <tbody>
          {seats.map(seat => <SeatRow key={seat.seat_id} seat={seat} t={translate} />)}
          <tr className={css.seatRow} data-seat="synthesis" data-status={SYNTHESIS_STATUSES.has(review.status) ? 'submitted' : 'pending'}>
            <td className={css.seatName}>{translate('seat.editorialSynthesizer')}</td>
            <td>
              <span className={css.statusChip} data-status={SYNTHESIS_STATUSES.has(review.status) ? 'submitted' : 'pending'}>
                {SYNTHESIS_STATUSES.has(review.status) ? translate('seatStatus.submitted') : translate('seatStatus.pending')}
              </span>
            </td>
            <td className={css.findings}><span className={css.muted}>—</span></td>
          </tr>
        </tbody>
      </table>
      <footer className={css.reviewFooter}>
        {reportReady
          ? <button type="button" className={css.reportButton} disabled={reportBusy}
              onClick={() => onOpenReport(review.review_id)}>{translate('review.openReport')}</button>
          : <span className={css.muted}>{translate('review.noReport')}</span>}
      </footer>
    </section>
  )
}

/** The Academic Review panel body: poll, list, empty/error/loading states. */
export function AcademicReviewPanel({ t }: AcademicReviewPanelProps) {
  const visible = useSyncExternalStore(subscribeVisibility, visibilitySnapshot)
  const [load, setLoad] = useState<ReviewsLoad | null>(null)
  const [reload, setReload] = useState(0)
  const [reportBusy, setReportBusy] = useState(false)
  const [nonce, setNonce] = useState(0)

  useEffect(() => {
    if (!visible) return
    let disposed = false
    const load = async (): Promise<void> => {
      const result = await fetchReviews()
      if (!disposed) setLoad(result)
    }
    void load()
    const timer = window.setInterval(load, POLL_MS)
    return () => { disposed = true; window.clearInterval(timer) }
  }, [visible, reload, nonce])

  const onOpenReport = useCallback(async (reviewId: string) => {
    setReportBusy(true)
    try { await openReport(reviewId) } finally { setReportBusy(false) }
  }, [])

  const refresh = useCallback(() => {
    setLoad(null)
    setReload(value => value + 1)
  }, [])

  const reviews = load?.kind === 'ok' ? load.reviews : NO_REVIEWS

  return (
    <div className={css.panel} data-testid="academic-review-panel">
      <header className={css.panelHeader}>
        <h2 className={css.panelTitle}>{t('panel.title')}</h2>
        <p className={css.panelDescription}>{t('panel.description')}</p>
        <button type="button" className={css.refreshButton} onClick={refresh}>{t('panel.refresh')}</button>
      </header>
      {load === null
        ? <p className={css.stateText} data-state="loading">{t('panel.loading')}</p>
        : load.kind === 'unauthorized'
          ? <p className={css.stateText} data-state="unauthorized">{t('panel.error')}</p>
          : load.kind === 'error'
            ? <p className={css.stateText} data-state="error">{t('error.loadFailed', { message: load.message })}</p>
            : reviews.length === 0
              ? <div className={css.emptyState} data-state="empty">
                  <p className={css.emptyTitle}>{t('panel.emptyTitle')}</p>
                  <p className={css.emptyBody}>{t('panel.emptyBody')}</p>
                </div>
              : <div className={css.reviewList}>
                  {reviews.map(review => (
                    <ReviewCard key={review.review_id} review={review} t={t} onOpenReport={onOpenReport} reportBusy={reportBusy} />
                  ))}
                </div>}
      <button type="button" hidden aria-hidden data-nonce={nonce} onClick={() => setNonce(value => value + 1)} />
    </div>
  )
}
