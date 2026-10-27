/**
 * Academic Review panel: review id, seats, findings tally, the pending human
 * checkpoint and (once approved) the rendered editorial decision letter.
 *
 * The panel is strictly read-only: it issues GET requests to the plugin's
 * three read-only routes, never calls a write path, and shows the exact tool
 * call the user still has to run in the session.
 */
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import {
  checkpointOf,
  fetchReport,
  fetchReviews,
  nextCallFor,
  openReport,
  SEAT_IDS,
  type ReportLoad,
  type ReviewCheckpoint,
  type ReviewSummary,
  type ReviewsLoad,
  type SeatSummary,
} from './review-data.ts'
import { renderLetter } from './letter-markdown.tsx'
import css from './AcademicReviewPanel.module.css'

/** Locale prop contract for the panel. */
export type AcademicReviewPanelProps = PropsLocale<'academicReview'>

/** Poll cadence while the panel is visible (ms). */
const POLL_MS = 10_000

/** How long the copy button keeps its result label (ms). */
const COPY_FEEDBACK_MS = 2_400

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

/**
 * Copy text to the clipboard. Browser-only, best effort: a host without the
 * async clipboard API reports failure so the caller can ask for a manual copy.
 * @param value - text to copy.
 * @returns whether the clipboard accepted it.
 */
async function copyText(value: string): Promise<boolean> {
  try {
    if (typeof navigator === 'undefined') return false
    const clipboard = navigator.clipboard
    if (clipboard === undefined || typeof clipboard.writeText !== 'function') return false
    await clipboard.writeText(value)
    return true
  } catch {
    return false
  }
}

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

/** Copy-to-clipboard button for one call text. */
function CopyButton({ text, t }: { text: string; t: LooseTranslate }) {
  const [state, setState] = useState<'idle' | 'copied' | 'failed'>('idle')
  const timer = useRef<number | null>(null)
  useEffect(() => () => {
    if (timer.current !== null) window.clearTimeout(timer.current)
  }, [])
  const onCopy = useCallback(() => {
    void (async () => {
      const copied = await copyText(text)
      setState(copied ? 'copied' : 'failed')
      if (timer.current !== null) window.clearTimeout(timer.current)
      timer.current = window.setTimeout(() => setState('idle'), COPY_FEEDBACK_MS)
    })()
  }, [text])
  const label = state === 'copied'
    ? t('checkpoint.copied')
    : state === 'failed' ? t('checkpoint.copyFailed') : t('checkpoint.copy')
  return (
    <button
      type="button"
      className={css.copyButton}
      data-testid="copy-call"
      data-copy-state={state}
      onClick={onCopy}
    >{label}</button>
  )
}

/** Prominent card naming the pending checkpoint and the exact next call. */
function CheckpointCard({ review, checkpoint, t }: {
  review: ReviewSummary
  checkpoint: ReviewCheckpoint
  t: LooseTranslate
}) {
  const call = nextCallFor(review, checkpoint)
  return (
    <div className={css.checkpointCard} data-testid="checkpoint-card" data-checkpoint={checkpoint}>
      <p className={css.checkpointHeading}>{t('checkpoint.heading.' + checkpoint)}</p>
      <p className={css.checkpointBody}>{t('checkpoint.body.' + checkpoint)}</p>
      {call.requiresDevilsAdvocateAdjudication
        ? <p className={css.checkpointRequirement} data-testid="checkpoint-requirement">{t('checkpoint.daRequirement')}</p>
        : null}
      <p className={css.checkpointLabel}>{t('checkpoint.nextCall')}</p>
      <pre className={css.callBlock} data-testid="next-call"><code>{call.call}</code></pre>
      <div className={css.checkpointActions}>
        <CopyButton text={call.call} t={t} />
        <span className={css.muted}>{t('checkpoint.readOnlyNote')}</span>
      </div>
    </div>
  )
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

/** The editorial decision letter, fetched once and rendered as React nodes. */
function ReportLetter({ reviewId, t }: { reviewId: string; t: LooseTranslate }) {
  const [load, setLoad] = useState<ReportLoad | null>(null)
  useEffect(() => {
    let disposed = false
    void (async () => {
      const result = await fetchReport(reviewId)
      if (!disposed) setLoad(result)
    })()
    return () => { disposed = true }
  }, [reviewId])
  return (
    <section className={css.letterSection} data-testid="report-letter" data-state={load === null ? 'loading' : load.kind}>
      <h4 className={css.letterHeading}>{t('report.heading')}</h4>
      {load === null
        ? <p className={css.stateText} data-state="report-loading">{t('report.loading')}</p>
        : load.kind === 'ok'
          ? (load.markdown.trim() === ''
              ? <p className={css.muted} data-state="report-empty">{t('report.empty')}</p>
              : <div className={css.letter} data-testid="letter-body">{renderLetter(load.markdown)}</div>)
          : load.kind === 'not-ready'
            ? <p className={css.muted} data-state="report-not-ready">{t('error.reportNotReady')}</p>
            : load.kind === 'not-found'
              ? <p className={css.muted} data-state="report-not-found">{t('error.notFound')}</p>
              : load.kind === 'unauthorized'
                ? <p className={css.muted} data-state="report-unauthorized">{t('panel.error')}</p>
                : <p className={css.stateText} data-state="report-error">{t('error.reportLoadFailed', { message: load.message })}</p>}
    </section>
  )
}

/** One review card: header facts, checkpoint card, seat table, report. */
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
  const checkpoint = checkpointOf(review)
  return (
    <section className={css.reviewCard} data-review-id={review.review_id} data-status={review.status}>
      <header className={css.reviewHeader}>
        <h3 className={css.reviewTitle}>{review.review_id}</h3>
        <span className={css.statusChip} data-status={review.status}>{translate('status.' + review.status)}</span>
        {checkpoint === null
          ? null
          : <span className={css.checkpointBadge} title={translate('review.checkpointHint')}>⏸ {translate('review.checkpoint')}</span>}
      </header>
      {checkpoint === null ? null : <CheckpointCard review={review} checkpoint={checkpoint} t={translate} />}
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
      {reportReady ? <ReportLetter reviewId={review.review_id} t={translate} /> : null}
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
