import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
/** Academic Review panel: review id, seats, findings tally, checkpoints. */
import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { fetchReviews, openReport, SEAT_IDS } from "./review-data.js";
import css from './AcademicReviewPanel.module.css';
/** Poll cadence while the panel is visible (ms). */
const POLL_MS = 10_000;
/** Seats the synthesizer section stands in for (not a panel seat). */
const SYNTHESIS_STATUSES = new Set(['all_submitted', 'awaiting_synthesis_approval', 'report_ready']);
/** Stable empty list so effect deps cannot churn. */
const NO_REVIEWS = [];
/** Small observable used to gate polling on document visibility. */
function visibilitySnapshot() {
    return typeof document === 'undefined' ? true : !document.hidden;
}
function subscribeVisibility(onChange) {
    if (typeof document === 'undefined')
        return () => { };
    document.addEventListener('visibilitychange', onChange);
    return () => document.removeEventListener('visibilitychange', onChange);
}
/** Format the update timestamp in the viewer's locale, best effort. */
function formatTime(iso) {
    const date = new Date(iso);
    if (Number.isNaN(date.getTime()))
        return iso;
    try {
        return date.toLocaleString();
    }
    catch {
        return iso;
    }
}
/** One seat row: role name, status chip, findings tally. */
function SeatRow({ seat, t }) {
    const severity = seat.findings_by_severity ?? {};
    const tally = ['critical', 'major', 'minor', 'comment']
        .filter(key => (severity[key] ?? 0) > 0)
        .map(key => t('severity.' + key) + ' ' + String(severity[key]));
    return (_jsxs("tr", { className: css.seatRow, "data-seat": seat.seat_id, "data-status": seat.status, children: [_jsx("td", { className: css.seatName, children: t('seat.id.' + seat.seat_id) }), _jsx("td", { children: _jsx("span", { className: css.statusChip, "data-status": seat.status, children: t('seatStatus.' + seat.status) }) }), _jsx("td", { className: css.findings, children: seat.findings_open === 0
                    ? _jsx("span", { className: css.muted, children: "0" })
                    : _jsxs(_Fragment, { children: [String(seat.findings_open), tally.length > 0 ? _jsxs("span", { className: css.muted, children: [" \u00B7 ", tally.join(' / ')] }) : null] }) })] }));
}
/** One review card: header facts, seat table, synthesis row, report action. */
function ReviewCard({ review, t, onOpenReport, reportBusy }) {
    const translate = t;
    const seats = useMemo(() => {
        const byId = new Map(review.seats.map(seat => [seat.seat_id, seat]));
        return SEAT_IDS.map(id => byId.get(id)).filter((seat) => seat !== undefined);
    }, [review.seats]);
    const reportReady = review.status === 'report_ready';
    return (_jsxs("section", { className: css.reviewCard, "data-review-id": review.review_id, "data-status": review.status, children: [_jsxs("header", { className: css.reviewHeader, children: [_jsx("h3", { className: css.reviewTitle, children: review.review_id }), _jsx("span", { className: css.statusChip, "data-status": review.status, children: translate('status.' + review.status) }), review.pending_checkpoint
                        ? _jsxs("span", { className: css.checkpointBadge, title: translate('review.checkpointHint'), children: ["\u23F8 ", translate('review.checkpoint')] })
                        : null] }), _jsxs("dl", { className: css.facts, children: [_jsxs("div", { children: [_jsx("dt", { children: translate('review.mode') }), _jsx("dd", { children: review.mode })] }), _jsxs("div", { children: [_jsx("dt", { children: translate('review.updated') }), _jsx("dd", { children: formatTime(review.updated_at) })] })] }), _jsx("h4", { className: css.seatHeading, children: translate('seat.heading') }), _jsx("table", { className: css.seatTable, children: _jsxs("tbody", { children: [seats.map(seat => _jsx(SeatRow, { seat: seat, t: translate }, seat.seat_id)), _jsxs("tr", { className: css.seatRow, "data-seat": "synthesis", "data-status": SYNTHESIS_STATUSES.has(review.status) ? 'submitted' : 'pending', children: [_jsx("td", { className: css.seatName, children: translate('seat.editorialSynthesizer') }), _jsx("td", { children: _jsx("span", { className: css.statusChip, "data-status": SYNTHESIS_STATUSES.has(review.status) ? 'submitted' : 'pending', children: SYNTHESIS_STATUSES.has(review.status) ? translate('seatStatus.submitted') : translate('seatStatus.pending') }) }), _jsx("td", { className: css.findings, children: _jsx("span", { className: css.muted, children: "\u2014" }) })] })] }) }), _jsx("footer", { className: css.reviewFooter, children: reportReady
                    ? _jsx("button", { type: "button", className: css.reportButton, disabled: reportBusy, onClick: () => onOpenReport(review.review_id), children: translate('review.openReport') })
                    : _jsx("span", { className: css.muted, children: translate('review.noReport') }) })] }));
}
/** The Academic Review panel body: poll, list, empty/error/loading states. */
export function AcademicReviewPanel({ t }) {
    const visible = useSyncExternalStore(subscribeVisibility, visibilitySnapshot);
    const [load, setLoad] = useState(null);
    const [reload, setReload] = useState(0);
    const [reportBusy, setReportBusy] = useState(false);
    const [nonce, setNonce] = useState(0);
    useEffect(() => {
        if (!visible)
            return;
        let disposed = false;
        const load = async () => {
            const result = await fetchReviews();
            if (!disposed)
                setLoad(result);
        };
        void load();
        const timer = window.setInterval(load, POLL_MS);
        return () => { disposed = true; window.clearInterval(timer); };
    }, [visible, reload, nonce]);
    const onOpenReport = useCallback(async (reviewId) => {
        setReportBusy(true);
        try {
            await openReport(reviewId);
        }
        finally {
            setReportBusy(false);
        }
    }, []);
    const refresh = useCallback(() => {
        setLoad(null);
        setReload(value => value + 1);
    }, []);
    const reviews = load?.kind === 'ok' ? load.reviews : NO_REVIEWS;
    return (_jsxs("div", { className: css.panel, "data-testid": "academic-review-panel", children: [_jsxs("header", { className: css.panelHeader, children: [_jsx("h2", { className: css.panelTitle, children: t('panel.title') }), _jsx("p", { className: css.panelDescription, children: t('panel.description') }), _jsx("button", { type: "button", className: css.refreshButton, onClick: refresh, children: t('panel.refresh') })] }), load === null
                ? _jsx("p", { className: css.stateText, "data-state": "loading", children: t('panel.loading') })
                : load.kind === 'unauthorized'
                    ? _jsx("p", { className: css.stateText, "data-state": "unauthorized", children: t('panel.error') })
                    : load.kind === 'error'
                        ? _jsx("p", { className: css.stateText, "data-state": "error", children: t('error.loadFailed', { message: load.message }) })
                        : reviews.length === 0
                            ? _jsxs("div", { className: css.emptyState, "data-state": "empty", children: [_jsx("p", { className: css.emptyTitle, children: t('panel.emptyTitle') }), _jsx("p", { className: css.emptyBody, children: t('panel.emptyBody') })] })
                            : _jsx("div", { className: css.reviewList, children: reviews.map(review => (_jsx(ReviewCard, { review: review, t: t, onOpenReport: onOpenReport, reportBusy: reportBusy }, review.review_id))) }), _jsx("button", { type: "button", hidden: true, "aria-hidden": true, "data-nonce": nonce, onClick: () => setNonce(value => value + 1) })] }));
}
