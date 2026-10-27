/**
 * Durable review state for the dsh-academic-review plugin.
 *
 * Layout (docs/PORT_SPEC.md §3; the review-root directory name is fixed by the
 * team contract to '.academic-review'):
 *
 *   <workspace>/.academic-review/<review_id>/state.json
 *   <workspace>/.academic-review/<review_id>/seats/<seat_id>.json
 *   <workspace>/.academic-review/<review_id>/seats/<seat_id>.md
 *   <workspace>/.academic-review/<review_id>/editorial_decision.md
 *   <workspace>/.academic-review/<review_id>/revision_roadmap.md
 *
 * Invariants enforced here (not in the tool layer, so tests and any future
 * prompt pack share one implementation):
 * - Every mutation is an atomic same-directory rename of a written temp file.
 * - A seat report is immutable once committed; a duplicate submit is refused.
 * - Only seat ids of the Phase 1 panel are accepted.
 * - Every finding carries at least one evidence quote plus a manuscript
 *   location; severities and verdicts come from closed enums.
 * - The paper's SHA-256 is re-verified on every create/read/modify cycle, so a
 *   manuscript edited mid-review fails loudly instead of being half-reviewed.
 * - Nothing here ever writes to the manuscript path.
 *
 * @module dsh-academic-review/state
 */
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { basename, dirname, extname, join, resolve } from 'node:path';
/** Panel seats fixed by the Phase 1 port (docs/PORT_SPEC.md §2.1). */
export const SEAT_IDS = ['eic', 'methodology', 'domain', 'perspective', 'da'];
/** Finding severities accepted from a seat report. */
export const SEVERITIES = ['critical', 'major', 'minor', 'comment'];
/** Per-seat verdicts accepted from a seat report. */
export const VERDICTS = ['accept', 'minor_revision', 'major_revision', 'reject'];
/** Operational modes implemented in Phase 1. */
export const MODES = ['full', 'quick', 'methodology-focus'];
/** Upstream modes that exist but are not ported yet (refused, never faked). */
export const UNIMPLEMENTED_MODES = ['re-review', 'guided', 'calibration'];
/** Review lifecycle statuses. */
export const REVIEW_STATUSES = [
    'created',
    'panel_configured',
    'awaiting_panel_confirmation',
    'in_review',
    'all_submitted',
    'awaiting_synthesis_approval',
    'report_ready',
    'abandoned',
];
/** Seat lifecycle statuses. */
export const SEAT_STATUSES = ['pending', 'dispatched', 'submitted', 'failed'];
/** Advisory checker outcomes; upstream defines "not run" as a valid outcome. */
export const ADVISORY_OUTCOMES = ['not_run', 'passed', 'failed', 'skipped'];
/** Accepted manuscript extensions; PDF/DOCX are rejected, never parsed. */
export const ACCEPTED_PAPER_EXTENSIONS = ['.md', '.tex', '.txt'];
/** Attribution rendered into every generated report (CC BY-NC 4.0 BY term). */
export const ATTRIBUTION_LINE = 'Unofficial DSH port of the Academic Research Skills skill "academic-paper-reviewer" '
    + 'v1.11.1 by Cheng-I Wu (https://github.com/Imbad0202/academic-research-skills, '
    + 'commit 1ec249df98728682dfbbdfb940a658338bfd6f80), CC BY-NC 4.0. '
    + 'Not affiliated with or endorsed by the upstream author.';
/** Canonical seat table (upstream academic-paper-reviewer/agents/*). */
export const SEAT_DEFINITIONS = {
    eic: {
        seatId: 'eic',
        roleMarker: 'EIC',
        roleName: 'Journal-Fit Reviewer / Editor-in-Chief',
        agentFile: 'academic-paper-reviewer/agents/eic_agent.md',
        configurationCard: 1,
    },
    methodology: {
        seatId: 'methodology',
        roleMarker: 'R1',
        roleName: 'Peer Reviewer 1 - Methodology',
        agentFile: 'academic-paper-reviewer/agents/methodology_reviewer_agent.md',
        configurationCard: 2,
    },
    domain: {
        seatId: 'domain',
        roleMarker: 'R2',
        roleName: 'Peer Reviewer 2 - Domain',
        agentFile: 'academic-paper-reviewer/agents/domain_reviewer_agent.md',
        configurationCard: 3,
    },
    perspective: {
        seatId: 'perspective',
        roleMarker: 'R3',
        roleName: 'Peer Reviewer 3 - Perspective',
        agentFile: 'academic-paper-reviewer/agents/perspective_reviewer_agent.md',
        configurationCard: 4,
    },
    da: {
        seatId: 'da',
        roleMarker: 'DA',
        roleName: "Devil's Advocate",
        agentFile: 'academic-paper-reviewer/agents/devils_advocate_reviewer_agent.md',
        configurationCard: null,
    },
};
/** Field-analysis pre-pass agent file (Phase 0). */
export const FIELD_ANALYST_AGENT_FILE = 'academic-paper-reviewer/agents/field_analyst_agent.md';
/** Editorial synthesis agent file (Phase 2). */
export const EDITORIAL_SYNTHESIZER_AGENT_FILE = 'academic-paper-reviewer/agents/editorial_synthesizer_agent.md';
/** Seats a mode requires before the panel counts as complete. */
export const MODE_SEATS = {
    full: ['eic', 'methodology', 'domain', 'perspective', 'da'],
    quick: ['eic'],
    'methodology-focus': ['eic', 'methodology'],
};
/** Error carrying a machine-readable review failure code. */
export class ReviewError extends Error {
    /** Failure code the tool layer renders verbatim. */
    code;
    constructor(code, message) {
        super(message);
        this.name = 'ReviewError';
        this.code = code;
    }
}
const DEFAULT_STATE_DIR = '.academic-review';
const DEFAULT_MAX_PAPER_BYTES = 1024 * 1024;
const DEFAULT_UPSTREAM_SKILL_VERSION = '1.11.1';
const DEFAULT_UPSTREAM_COMMIT = '1ec249df98728682dfbbdfb940a658338bfd6f80';
const RENAME_RETRIES = 3;
const RENAME_RETRY_DELAY_MS = 50;
const ISO_WITH_OFFSET = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;
/** Current time as ISO-8601 with the local UTC offset (never a bare Z). */
export function nowIso(date = new Date()) {
    const pad = (value, width = 2) => String(Math.abs(value)).padStart(width, '0');
    const offsetMinutes = -date.getTimezoneOffset();
    const sign = offsetMinutes >= 0 ? '+' : '-';
    const hours = pad(Math.trunc(Math.abs(offsetMinutes) / 60));
    const minutes = pad(Math.abs(offsetMinutes) % 60);
    return String(date.getFullYear()) + '-' + pad(date.getMonth() + 1) + '-' + pad(date.getDate())
        + 'T' + pad(date.getHours()) + ':' + pad(date.getMinutes()) + ':' + pad(date.getSeconds())
        + sign + hours + ':' + minutes;
}
/** Whether a string is an ISO-8601 timestamp with an explicit offset. */
export function isIsoTimestamp(value) {
    return typeof value === 'string' && ISO_WITH_OFFSET.test(value);
}
/** SHA-256 hex digest of a buffer. */
export function sha256Of(buffer) {
    return createHash('sha256').update(buffer).digest('hex');
}
/** Whether a value is a Phase 1 seat id. */
export function isSeatId(value) {
    return typeof value === 'string' && SEAT_IDS.includes(value);
}
/** Whether a value is an implemented Phase 1 mode. */
export function isReviewMode(value) {
    return typeof value === 'string' && MODES.includes(value);
}
/**
 * Resolve one review root directory.
 * @param config - store configuration.
 * @returns absolute review-root path.
 */
export function reviewRootOf(config) {
    const stateDir = (config.stateDir ?? DEFAULT_STATE_DIR).trim();
    return resolve(config.workspace, stateDir === '' ? DEFAULT_STATE_DIR : stateDir);
}
/**
 * Resolve one review directory.
 * @param config - store configuration.
 * @param reviewId - review id.
 * @returns absolute review directory path.
 */
export function reviewDirOf(config, reviewId) {
    if (!/^[A-Za-z0-9._-]+$/.test(reviewId)) {
        throw new ReviewError('review_not_found', 'invalid review id "' + reviewId + '"');
    }
    return join(reviewRootOf(config), reviewId);
}
/**
 * Reject a manuscript path whose extension Phase 1 cannot read.
 * @param paperPath - caller-supplied manuscript path.
 * @returns the normalized lowercase extension without the dot.
 */
export function requireSupportedFormat(paperPath) {
    const extension = extname(paperPath).toLowerCase();
    if (extension === '.pdf') {
        throw new ReviewError('unsupported_format', 'PDF manuscripts are not supported by this Phase 1 port (no PDF parsing, no OCR). '
            + 'Extract the text to .md, .tex, or .txt and create the review again.');
    }
    if (!ACCEPTED_PAPER_EXTENSIONS.includes(extension)) {
        throw new ReviewError('unsupported_format', 'unsupported manuscript format "' + (extension === '' ? '(none)' : extension) + '": this port accepts '
            + ACCEPTED_PAPER_EXTENSIONS.join(', ') + ' only');
    }
    return extension.slice(1);
}
/**
 * Write text through a temp file plus same-directory rename, falling back to an
 * in-place write when a transient Windows lock keeps the target open.
 * @param file - target path.
 * @param text - exact file content.
 */
export async function writeTextAtomic(file, text) {
    const directory = dirname(file);
    await mkdir(directory, { recursive: true });
    const temporary = join(directory, '.' + basename(file) + '.' + String(process.pid) + '.' + randomUUID() + '.tmp');
    await writeFile(temporary, text, 'utf8');
    for (let attempt = 0;; attempt += 1) {
        try {
            await rename(temporary, file);
            return;
        }
        catch (error) {
            const code = error.code ?? '';
            const retryable = code === 'EPERM' || code === 'EACCES' || code === 'EBUSY'
                || code === 'EEXIST' || code === 'ENOTEMPTY';
            if (retryable && attempt < RENAME_RETRIES) {
                await new Promise(resolveDelay => { setTimeout(resolveDelay, RENAME_RETRY_DELAY_MS); });
                continue;
            }
            try {
                await writeFile(file, text, 'utf8');
            }
            finally {
                await unlink(temporary).catch(() => undefined);
            }
            return;
        }
    }
}
/**
 * Write a value as JSON through an atomic replace.
 * @param file - target path.
 * @param value - losslessly serializable value.
 */
export async function writeJsonAtomic(file, value) {
    await writeTextAtomic(file, JSON.stringify(value, null, 2) + '\n');
}
/** Validate one evidence entry, throwing a path-qualified ReviewError. */
function validateEvidence(value, path) {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
        throw new ReviewError('invalid_report', path + ' must be an object with quote and location');
    }
    const record = value;
    if (typeof record.quote !== 'string' || record.quote.trim() === '') {
        throw new ReviewError('invalid_report', path + '.quote must be a non-empty string');
    }
    if (typeof record.location !== 'string' || record.location.trim() === '') {
        throw new ReviewError('invalid_report', path + '.location must be a non-empty string (section/line locator)');
    }
    return { quote: record.quote, location: record.location };
}
/** Validate one finding, throwing a path-qualified ReviewError. */
function validateFinding(value, path) {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
        throw new ReviewError('invalid_report', path + ' must be an object');
    }
    const record = value;
    if (typeof record.id !== 'string' || record.id.trim() === '') {
        throw new ReviewError('invalid_report', path + '.id must be a non-empty string');
    }
    if (typeof record.severity !== 'string' || !SEVERITIES.includes(record.severity)) {
        throw new ReviewError('invalid_report', path + '.severity must be one of ' + SEVERITIES.join('|'));
    }
    if (typeof record.title !== 'string' || record.title.trim() === '') {
        throw new ReviewError('invalid_report', path + '.title must be a non-empty string');
    }
    if (typeof record.detail !== 'string' || record.detail.trim() === '') {
        throw new ReviewError('invalid_report', path + '.detail must be a non-empty string');
    }
    if (!Array.isArray(record.evidence) || record.evidence.length === 0) {
        throw new ReviewError('invalid_report', path + '.evidence must list at least one { quote, location } entry');
    }
    const evidence = record.evidence.map((item, index) => validateEvidence(item, path + '.evidence[' + String(index) + ']'));
    return {
        id: record.id,
        severity: record.severity,
        title: record.title,
        detail: record.detail,
        evidence,
    };
}
/**
 * Validate a submitter-supplied seat report body and normalize it.
 * @param value - raw report argument from the submit tool.
 * @param seatId - seat the report is offered for.
 * @param role - expected role marker.
 * @returns the validated report content without commit metadata.
 */
export function validateSeatReportBody(value, seatId, role) {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
        throw new ReviewError('invalid_report', 'report must be an object');
    }
    const record = value;
    if (record.seat_id !== undefined && record.seat_id !== seatId) {
        throw new ReviewError('invalid_seat_id', 'report.seat_id "' + String(record.seat_id) + '" does not match seat "' + seatId + '"');
    }
    if (record.role !== undefined && record.role !== role) {
        throw new ReviewError('invalid_report', 'report.role must be the seat role marker "' + role + '"');
    }
    if (typeof record.verdict !== 'string' || !VERDICTS.includes(record.verdict)) {
        throw new ReviewError('invalid_report', 'report.verdict must be one of ' + VERDICTS.join('|'));
    }
    if (typeof record.confidence !== 'number' || !Number.isFinite(record.confidence)
        || record.confidence < 0 || record.confidence > 1) {
        throw new ReviewError('invalid_report', 'report.confidence must be a number between 0 and 1');
    }
    if (!isIsoTimestamp(record.created_at)) {
        throw new ReviewError('invalid_report', 'report.created_at must be an ISO-8601 timestamp with an explicit UTC offset');
    }
    if (!Array.isArray(record.findings)) {
        throw new ReviewError('invalid_report', 'report.findings must be an array');
    }
    const findings = record.findings.map((item, index) => validateFinding(item, 'report.findings[' + String(index) + ']'));
    const seen = new Set();
    for (const finding of findings) {
        if (seen.has(finding.id)) {
            throw new ReviewError('invalid_report', 'duplicate finding id "' + finding.id + '" in one report');
        }
        seen.add(finding.id);
    }
    if (record.summary !== undefined && typeof record.summary !== 'string') {
        throw new ReviewError('invalid_report', 'report.summary must be a string when present');
    }
    let provenance;
    if (record.provenance !== undefined) {
        if (typeof record.provenance !== 'object' || record.provenance === null || Array.isArray(record.provenance)) {
            throw new ReviewError('invalid_report', 'report.provenance must be an object when present');
        }
        const raw = record.provenance;
        const normalized = {};
        if (raw.model !== undefined) {
            if (typeof raw.model !== 'string')
                throw new ReviewError('invalid_report', 'report.provenance.model must be a string');
            normalized.model = raw.model;
        }
        if (raw.peerOutputVisible !== undefined) {
            if (typeof raw.peerOutputVisible !== 'boolean')
                throw new ReviewError('invalid_report', 'report.provenance.peerOutputVisible must be a boolean');
            normalized.peerOutputVisible = raw.peerOutputVisible;
        }
        if (raw.contextFresh !== undefined) {
            if (typeof raw.contextFresh !== 'boolean')
                throw new ReviewError('invalid_report', 'report.provenance.contextFresh must be a boolean');
            normalized.contextFresh = raw.contextFresh;
        }
        if (raw.humanOperator !== undefined) {
            if (typeof raw.humanOperator !== 'string')
                throw new ReviewError('invalid_report', 'report.provenance.humanOperator must be a string');
            normalized.humanOperator = raw.humanOperator;
        }
        provenance = normalized;
    }
    if (provenance !== undefined && provenance.peerOutputVisible === true) {
        throw new ReviewError('invalid_report', 'report.provenance.peerOutputVisible must be false: Phase 1 seats commit without seeing peer cards (Iron Rule #2)');
    }
    const body = {
        created_at: record.created_at,
        verdict: record.verdict,
        confidence: record.confidence,
        findings,
        ...(record.summary === undefined ? {} : { summary: record.summary }),
        ...(provenance === undefined ? {} : { provenance }),
    };
    return body;
}
/**
 * Validate a persisted review record read back from disk.
 * @param value - parsed JSON.
 * @param reviewId - directory-derived review id.
 * @returns the validated record.
 */
export function validateReviewState(value, reviewId) {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
        throw new ReviewError('invalid_state', 'review "' + reviewId + '" state.json is not an object');
    }
    const state = value;
    if (state.schema_version !== '1') {
        throw new ReviewError('invalid_state', 'review "' + reviewId + '" has unsupported schema_version');
    }
    if (state.review_id !== reviewId) {
        throw new ReviewError('invalid_state', 'review "' + reviewId + '" state.json declares review_id "' + String(state.review_id) + '"');
    }
    if (!isReviewMode(state.mode)) {
        throw new ReviewError('invalid_state', 'review "' + reviewId + '" has invalid mode');
    }
    if (!REVIEW_STATUSES.includes(state.status)) {
        throw new ReviewError('invalid_state', 'review "' + reviewId + '" has invalid status');
    }
    if (!Array.isArray(state.panel?.seats)) {
        throw new ReviewError('invalid_state', 'review "' + reviewId + '" state.json has no panel.seats array');
    }
    if (typeof state.paper?.sha256 !== 'string' || !/^[0-9a-f]{64}$/.test(state.paper.sha256)) {
        throw new ReviewError('invalid_state', 'review "' + reviewId + '" has no valid paper.sha256 pin');
    }
    return state;
}
/** Collapse a quote onto one Markdown bullet. */
function quoteForMarkdown(quote) {
    const single = quote.replace(/\s+/g, ' ').trim();
    return single.length > 280 ? single.slice(0, 277) + '...' : single;
}
/**
 * Render one committed seat report as Markdown (the seats/<seat>.md copy).
 * @param report - committed report.
 * @param roleName - human role name for the heading.
 * @returns Markdown document.
 */
export function renderSeatMarkdown(report, roleName) {
    const lines = [
        '# Review card - ' + report.role + ' (' + roleName + ')',
        '',
        '- Review: ' + report.review_id,
        '- Seat: ' + report.seat_id + ' (role marker ' + report.role + ')',
        '- Verdict: ' + report.verdict,
        '- Confidence: ' + report.confidence.toFixed(2),
        '- Created: ' + report.created_at,
        '- Committed: ' + report.submitted_at,
        '',
    ];
    if (report.summary !== undefined && report.summary.trim() !== '') {
        lines.push('## Summary', '', report.summary.trim(), '');
    }
    lines.push('## Findings', '');
    if (report.findings.length === 0) {
        lines.push('_No findings were recorded by this seat._', '');
    }
    for (const finding of report.findings) {
        lines.push('### ' + finding.id + ' - ' + finding.title + ' [' + finding.severity + ']', '', finding.detail.trim(), '', 'Evidence:', '');
        for (const evidence of finding.evidence) {
            lines.push('- at ' + evidence.location + ': ' + quoteForMarkdown(evidence.quote));
        }
        lines.push('');
    }
    if (report.provenance !== undefined) {
        lines.push('## Provenance', '');
        lines.push('- peer_output_visible: ' + String(report.provenance.peerOutputVisible ?? false)
            + ' (role separation is not independence)');
        if (report.provenance.model !== undefined)
            lines.push('- model: ' + report.provenance.model);
        if (report.provenance.contextFresh !== undefined)
            lines.push('- context_fresh: ' + String(report.provenance.contextFresh));
        if (report.provenance.humanOperator !== undefined)
            lines.push('- human_operator: ' + report.provenance.humanOperator);
        lines.push('');
    }
    lines.push('---', '', ATTRIBUTION_LINE, '');
    return lines.join('\n');
}
/**
 * Aggregate per-seat verdicts into one advisory decision.
 * The modal verdict wins; a tie resolves toward the more severe verdict.
 * @param verdicts - committed per-seat verdicts.
 * @returns the advisory decision, or null with no verdicts.
 */
export function decideFromVerdicts(verdicts) {
    if (verdicts.length === 0)
        return null;
    const counts = new Map();
    for (const verdict of verdicts)
        counts.set(verdict, (counts.get(verdict) ?? 0) + 1);
    const severityOrder = ['reject', 'major_revision', 'minor_revision', 'accept'];
    let best = 'reject';
    let bestCount = -1;
    for (const verdict of severityOrder) {
        const count = counts.get(verdict) ?? 0;
        if (count > bestCount) {
            best = verdict;
            bestCount = count;
        }
    }
    return best;
}
/** Count findings per severity for one card. */
function countSeverities(card) {
    const counts = { critical: 0, major: 0, minor: 0, comment: 0 };
    for (const finding of card.findings)
        counts[finding.severity] += 1;
    return counts;
}
/** Finding titles raised by more than one seat. */
function repeatedFindingTitles(cards) {
    const map = new Map();
    for (const card of cards) {
        for (const finding of card.findings) {
            const key = finding.title.trim().toLowerCase();
            const seats = map.get(key) ?? [];
            if (!seats.includes(card.role))
                seats.push(card.role);
            map.set(key, seats);
        }
    }
    return [...map.entries()]
        .filter(entry => entry[1].length > 1)
        .map(entry => ({ title: entry[0], seats: entry[1] }));
}
/**
 * Every Devil's Advocate CRITICAL finding id across the committed cards.
 * @param cards - committed cards.
 * @returns finding ids in seat/finding order.
 */
export function daCriticalFindingIds(cards) {
    const ids = [];
    for (const card of cards) {
        if (card.seat_id !== 'da')
            continue;
        for (const finding of card.findings) {
            if (finding.severity === 'critical')
                ids.push(finding.id);
        }
    }
    return ids;
}
/** Validate and complete the DA CRITICAL adjudication table. */
function normalizeAdjudications(adjudications, required) {
    const byId = new Map();
    for (const item of adjudications) {
        if (typeof item.finding_id !== 'string' || item.finding_id.trim() === '') {
            throw new ReviewError('invalid_report', 'each adjudication needs a non-empty finding_id');
        }
        if (item.outcome !== 'validated' && item.outcome !== 'rejected' && item.outcome !== 'unresolved') {
            throw new ReviewError('invalid_report', 'adjudication outcome for "' + item.finding_id + '" must be validated|rejected|unresolved');
        }
        if (typeof item.rationale !== 'string' || item.rationale.trim() === '') {
            throw new ReviewError('invalid_report', 'adjudication for "' + item.finding_id + '" needs a rationale');
        }
        byId.set(item.finding_id, { finding_id: item.finding_id, outcome: item.outcome, rationale: item.rationale });
    }
    const completed = [];
    for (const findingId of required) {
        completed.push(byId.get(findingId) ?? {
            finding_id: findingId,
            outcome: 'unresolved',
            rationale: "Not adjudicated yet: the synthesizer may not invent an outcome for a Devil's Advocate CRITICAL finding.",
        });
    }
    for (const entry of byId) {
        if (!required.includes(entry[0]))
            completed.push(entry[1]);
    }
    return completed;
}
/**
 * The checkpoint a caller is waiting on, or null.
 * @param state - review record.
 * @returns checkpoint name.
 */
export function pendingCheckpointOf(state) {
    switch (state.status) {
        case 'created':
        case 'panel_configured':
            return 'field_analysis_attachment';
        case 'awaiting_panel_confirmation':
            return 'panel_confirmation';
        case 'awaiting_synthesis_approval':
            return 'report_approval';
        default:
            return null;
    }
}
/** Render the editorial decision letter. */
function renderDecisionLetter(state, cards, decision, adjudications, timestamp) {
    const lines = [
        '# Editorial Decision Letter',
        '',
        '- Review: ' + state.review_id + ' (' + state.mode + ' mode)',
        '- Manuscript: ' + state.paper.path,
        '- Manuscript SHA-256: ' + state.paper.sha256,
        '- Synthesized: ' + timestamp,
        '- Advisory decision: ' + (decision ?? 'undetermined'),
        '',
        '> Role separation notice: the seats produced their cards without seeing',
        "> each other's output. Separated roles are not independent error processes,",
        '> and this letter inherits that limit.',
        '',
        '## 1. Seat verdicts',
        '',
        '| Seat | Role | Verdict | Confidence | critical/major/minor/comment |',
        '| --- | --- | --- | --- | --- |',
    ];
    for (const card of cards) {
        const counts = countSeverities(card);
        lines.push('| ' + card.seat_id + ' | ' + card.role + ' | ' + card.verdict + ' | '
            + card.confidence.toFixed(2) + ' | ' + String(counts.critical) + '/' + String(counts.major) + '/'
            + String(counts.minor) + '/' + String(counts.comment) + ' |');
    }
    lines.push('', '## 2. Consensus and disagreement', '');
    const agreeing = cards.filter(card => card.verdict === decision);
    const dissenting = cards.filter(card => card.verdict !== decision);
    lines.push('- Agreeing with the advisory decision: ' + (agreeing.length === 0
        ? '(none)'
        : agreeing.map(card => card.role + ' (' + card.verdict + ')').join(', ')));
    lines.push('- Dissenting: ' + (dissenting.length === 0
        ? '(none)'
        : dissenting.map(card => card.role + ' (' + card.verdict + ')').join(', ')));
    lines.push('');
    const repeated = repeatedFindingTitles(cards);
    if (repeated.length > 0) {
        lines.push('Findings raised by more than one seat (same title, a cross-seat attention signal):', '');
        for (const entry of repeated)
            lines.push('- ' + entry.title + ' - ' + entry.seats.join(', '));
        lines.push('');
    }
    else {
        lines.push('No finding title was raised by more than one seat.', '');
    }
    lines.push('## 3. Devil Advocate CRITICAL adjudication', '');
    if (adjudications.length === 0) {
        lines.push('No Devil Advocate CRITICAL finding was raised, so nothing needed adjudication.', '');
    }
    else {
        for (const item of adjudications) {
            lines.push('- ' + item.finding_id + ': ' + item.outcome + ' - ' + item.rationale);
        }
        lines.push('');
    }
    lines.push('## 4. Per-seat findings', '');
    for (const card of cards) {
        lines.push('### ' + card.role + ' - ' + card.verdict, '');
        if (card.findings.length === 0) {
            lines.push('_No findings._', '');
            continue;
        }
        for (const finding of card.findings) {
            lines.push('- ' + finding.id + ' [' + finding.severity + '] ' + finding.title);
            lines.push('  - ' + finding.detail.trim());
            for (const evidence of finding.evidence) {
                lines.push('  - evidence at ' + evidence.location + ': ' + quoteForMarkdown(evidence.quote));
            }
        }
        lines.push('');
    }
    lines.push('## 5. Decision', '', 'Advisory decision: ' + (decision ?? 'undetermined') + '.', '', 'Delivering this letter requires explicit human approval (human checkpoint 2,', 'docs/PORT_SPEC.md section 4.4). The plugin never approves its own output.', '', '---', '', ATTRIBUTION_LINE, '');
    return lines.join('\n');
}
/** Render the non-ranking revision roadmap. */
function renderRevisionRoadmap(state, cards, timestamp) {
    const lines = [
        '# Revision Roadmap (advisory, non-ranking)',
        '',
        '- Review: ' + state.review_id,
        '- Manuscript SHA-256: ' + state.paper.sha256,
        '- Generated: ' + timestamp,
        '',
        'Items are grouped by severity and listed in seat order. That order is not a',
        'priority ranking and implies no schedule; the authors decide what to act on.',
        '',
    ];
    const order = ['critical', 'major', 'minor', 'comment'];
    for (const severity of order) {
        const items = [];
        for (const card of cards) {
            for (const finding of card.findings) {
                if (finding.severity !== severity)
                    continue;
                const location = finding.evidence[0] === undefined ? 'no location' : finding.evidence[0].location;
                items.push('- [' + card.role + '] ' + finding.id + ' - ' + finding.title + ' (at ' + location + ')');
            }
        }
        lines.push('## ' + severity + ' (' + String(items.length) + ')', '');
        if (items.length === 0)
            lines.push('_none_', '');
        else
            lines.push(...items, '');
    }
    lines.push('---', '', ATTRIBUTION_LINE, '');
    return lines.join('\n');
}
/** A review-state store bound to one workspace. */
export class ReviewStore {
    /** Resolved configuration. */
    config;
    /** Resolved review root directory. */
    root;
    /** Oversize warning threshold in bytes. */
    maxPaperBytes;
    constructor(config) {
        this.config = { ...config };
        this.root = reviewRootOf(config);
        this.maxPaperBytes = config.maxPaperBytes ?? DEFAULT_MAX_PAPER_BYTES;
    }
    /**
     * Absolute directory of one review.
     * @param reviewId - review id.
     * @returns absolute path.
     */
    directoryOf(reviewId) {
        return reviewDirOf(this.config, reviewId);
    }
    /**
     * Absolute state.json path of one review.
     * @param reviewId - review id.
     * @returns absolute path.
     */
    statePathOf(reviewId) {
        return join(this.directoryOf(reviewId), 'state.json');
    }
    /**
     * Absolute seat-report path of one review.
     * @param reviewId - review id.
     * @param seatId - seat id.
     * @returns absolute path.
     */
    seatPathOf(reviewId, seatId) {
        return join(this.directoryOf(reviewId), 'seats', seatId + '.json');
    }
    /**
     * Create a review for one manuscript.
     * @param input - manuscript path plus optional mode.
     * @returns the freshly written record.
     */
    async create(input) {
        const mode = input.mode === undefined || input.mode.trim() === '' ? 'full' : input.mode.trim();
        if (!isReviewMode(mode)) {
            const hint = UNIMPLEMENTED_MODES.includes(mode)
                ? ' - that upstream mode is not implemented in this Phase 1 port and changes no state'
                : '';
            throw new ReviewError('invalid_mode', 'unsupported review mode "' + mode + '"' + hint
                + '; use one of ' + MODES.join('|'));
        }
        const paperPath = resolve(input.paperPath);
        const format = requireSupportedFormat(paperPath);
        let bytes;
        try {
            bytes = await readFile(paperPath);
        }
        catch (error) {
            throw new ReviewError('paper_unreadable', 'cannot read manuscript "' + paperPath + '": ' + error.message);
        }
        const timestamp = nowIso();
        const reviewId = 'rev-' + timestamp.slice(0, 10).replace(/-/g, '') + '-' + randomBytes(4).toString('hex');
        const warnings = [];
        if (bytes.byteLength > this.maxPaperBytes) {
            warnings.push('manuscript is ' + String(bytes.byteLength) + ' bytes, above the '
                + String(this.maxPaperBytes) + '-byte seat-context budget; seats must read it in sections and '
                + 'must not truncate silently (docs/PORT_SPEC.md section 4.8)');
        }
        const requiredSeats = MODE_SEATS[mode];
        const state = {
            schema_version: '1',
            review_id: reviewId,
            created_at: timestamp,
            updated_at: timestamp,
            mode,
            paper: {
                path: paperPath,
                sha256: sha256Of(bytes),
                bytes: bytes.byteLength,
                format,
            },
            upstream_skill_version: this.config.upstreamSkillVersion ?? DEFAULT_UPSTREAM_SKILL_VERSION,
            upstream_commit: this.config.upstreamCommit ?? DEFAULT_UPSTREAM_COMMIT,
            status: 'created',
            field_analysis: null,
            panel: {
                seats: SEAT_IDS.filter(seatId => requiredSeats.includes(seatId)).map(seatId => {
                    const definition = SEAT_DEFINITIONS[seatId];
                    const seat = {
                        seat_id: seatId,
                        role_marker: definition.roleMarker,
                        agent_file: definition.agentFile,
                        status: 'pending',
                        dispatched_at: null,
                        submitted_at: null,
                        configuration_card: definition.configurationCard,
                        report: null,
                    };
                    return seat;
                }),
            },
            synthesis: {
                requested_at: null,
                completed_at: null,
                decision: null,
                decision_letter_path: 'editorial_decision.md',
                revision_roadmap_path: 'revision_roadmap.md',
                da_critical_adjudications: [],
            },
            checkpoints: { panel_confirmed_at: null, report_approved_at: null },
            advisory_checks: { acronyms: 'not_run', suggested_references: 'not_run', reviewer_claims: 'not_run' },
            warnings,
        };
        const directory = this.directoryOf(reviewId);
        await mkdir(join(directory, 'seats'), { recursive: true });
        await writeJsonAtomic(join(directory, 'state.json'), state);
        return state;
    }
    /**
     * Read one review record.
     * @param reviewId - review id.
     * @returns validated record.
     */
    async read(reviewId) {
        const path = this.statePathOf(reviewId);
        let raw;
        try {
            raw = await readFile(path, 'utf8');
        }
        catch (error) {
            if (error.code === 'ENOENT') {
                throw new ReviewError('review_not_found', 'review "' + reviewId + '" was not found under ' + this.root);
            }
            throw new ReviewError('invalid_state', 'cannot read ' + path + ': ' + error.message);
        }
        let value;
        try {
            value = JSON.parse(raw.replace(/^\uFEFF/, ''));
        }
        catch (error) {
            throw new ReviewError('invalid_state', 'review "' + reviewId + '" state.json is not valid JSON: ' + error.message);
        }
        return validateReviewState(value, reviewId);
    }
    /**
     * Recompute the manuscript digest and fail when the bytes changed.
     * @param state - record whose paper block is pinned.
     * @returns the verified digest.
     */
    async verifyPaper(state) {
        let bytes;
        try {
            bytes = await readFile(state.paper.path);
        }
        catch (error) {
            throw new ReviewError('paper_unreadable', 'cannot re-read manuscript "' + state.paper.path + '": ' + error.message);
        }
        const digest = sha256Of(bytes);
        if (digest !== state.paper.sha256) {
            throw new ReviewError('paper_changed', 'manuscript "' + state.paper.path + '" changed during the review (pinned '
                + state.paper.sha256 + ', now ' + digest + '). Start a new review for the revised manuscript.');
        }
        return digest;
    }
    /** Persist a mutated record with a refreshed updated_at. */
    async save(state, timestamp = nowIso()) {
        const next = { ...state, updated_at: timestamp };
        await writeJsonAtomic(this.statePathOf(next.review_id), next);
        return next;
    }
    /** Locate one seat inside a record. */
    seatOf(state, seatId) {
        const seat = state.panel.seats.find(item => item.seat_id === seatId);
        if (seat === undefined) {
            const panel = state.panel.seats.map(item => item.seat_id).join('|');
            throw new ReviewError('invalid_seat_id', 'seat "' + seatId + '" is not part of this ' + state.mode
                + ' review panel (seats: ' + panel + ')');
        }
        return seat;
    }
    /**
     * Attach the Phase 0 field analysis and open the panel-confirmation checkpoint.
     * @param reviewId - review id.
     * @param analysis - analyst output, including the four configuration cards.
     * @returns the updated record.
     */
    async attachFieldAnalysis(reviewId, analysis) {
        const state = await this.read(reviewId);
        await this.verifyPaper(state);
        if (state.status !== 'created' && state.status !== 'panel_configured') {
            throw new ReviewError('state_conflict', 'field analysis can only be attached from status created|panel_configured, not ' + state.status);
        }
        const cards = analysis.configuration_cards;
        const cardSeats = state.panel.seats.filter(seat => seat.seat_id !== 'da').map(seat => seat.seat_id);
        if (!Array.isArray(cards) || cards.length !== cardSeats.length) {
            throw new ReviewError('invalid_state', 'field_analysis.configuration_cards must contain exactly '
                + String(cardSeats.length) + ' card(s) for this ' + state.mode + ' panel ('
                + cardSeats.join('|') + '); the Devil Advocate seat takes no card');
        }
        for (const card of cards) {
            if (!isSeatId(card.seat) || card.seat === 'da') {
                throw new ReviewError('invalid_state', 'configuration card seat "' + String(card.seat)
                    + '" must be one of eic|methodology|domain|perspective');
            }
            if (!state.panel.seats.some(seat => seat.seat_id === card.seat)) {
                throw new ReviewError('invalid_state', 'configuration card seat "' + card.seat + '" is not in this ' + state.mode + ' panel');
            }
            if (typeof card.identity !== 'string' || typeof card.expertise !== 'string' || typeof card.focus !== 'string') {
                throw new ReviewError('invalid_state', 'each configuration card needs identity, expertise, and focus strings');
            }
        }
        const timestamp = nowIso();
        const next = {
            ...state,
            status: 'awaiting_panel_confirmation',
            field_analysis: { ...analysis, analyst_run_at: isIsoTimestamp(analysis.analyst_run_at) ? analysis.analyst_run_at : timestamp },
        };
        return this.save(next, timestamp);
    }
    /**
     * Record the user's first human checkpoint on the configuration cards.
     * @param reviewId - review id.
     * @param cards - optional user-adjusted cards replacing the analyst's.
     * @returns the updated record.
     */
    async confirmPanel(reviewId, cards) {
        const state = await this.read(reviewId);
        await this.verifyPaper(state);
        if (state.status !== 'awaiting_panel_confirmation' && state.status !== 'panel_configured') {
            throw new ReviewError('state_conflict', 'the panel can only be confirmed from status panel_configured|awaiting_panel_confirmation, not ' + state.status);
        }
        const timestamp = nowIso();
        const fieldAnalysis = state.field_analysis === null
            ? null
            : { ...state.field_analysis, configuration_cards: cards ?? state.field_analysis.configuration_cards };
        const next = {
            ...state,
            status: 'in_review',
            field_analysis: fieldAnalysis,
            checkpoints: { ...state.checkpoints, panel_confirmed_at: timestamp },
            panel: {
                seats: state.panel.seats.map(seat => seat.status === 'pending'
                    ? { ...seat, status: 'dispatched', dispatched_at: timestamp }
                    : seat),
            },
        };
        return this.save(next, timestamp);
    }
    /**
     * Commit one seat report.
     * @param reviewId - review id.
     * @param seatId - seat the report belongs to.
     * @param report - validated report body.
     * @returns the updated record plus the committed report.
     */
    async submit(reviewId, seatId, report) {
        if (!isSeatId(seatId)) {
            throw new ReviewError('invalid_seat_id', 'unknown seat id "' + seatId + '": expected one of ' + SEAT_IDS.join('|'));
        }
        const state = await this.read(reviewId);
        await this.verifyPaper(state);
        if (state.checkpoints.panel_confirmed_at === null) {
            throw new ReviewError('panel_not_confirmed', 'the reviewer configuration cards have not been confirmed by the user yet '
                + '(human checkpoint 1, docs/PORT_SPEC.md section 2.2); no seat report may be committed before it');
        }
        const seat = this.seatOf(state, seatId);
        if (seat.status === 'submitted') {
            throw new ReviewError('duplicate_submission', 'seat "' + seatId + '" already committed its report at '
                + String(seat.submitted_at) + '; seat reports are immutable');
        }
        const body = validateSeatReportBody(report, seatId, seat.role_marker);
        const timestamp = nowIso();
        const committed = {
            schema_version: '1',
            review_id: reviewId,
            seat_id: seatId,
            role: seat.role_marker,
            created_at: body.created_at,
            submitted_at: timestamp,
            verdict: body.verdict,
            confidence: body.confidence,
            ...(body.summary === undefined ? {} : { summary: body.summary }),
            findings: body.findings,
            ...(body.provenance === undefined ? {} : { provenance: body.provenance }),
        };
        await writeJsonAtomic(this.seatPathOf(reviewId, seatId), committed);
        await writeTextAtomic(join(this.directoryOf(reviewId), 'seats', seatId + '.md'), renderSeatMarkdown(committed, SEAT_DEFINITIONS[seatId].roleName));
        const allSubmitted = state.panel.seats.every(item => item.seat_id === seatId || item.status === 'submitted');
        const next = {
            ...state,
            status: allSubmitted ? 'all_submitted' : 'in_review',
            panel: {
                seats: state.panel.seats.map(item => item.seat_id === seatId
                    ? { ...item, status: 'submitted', submitted_at: timestamp, report: committed }
                    : item),
            },
        };
        const saved = await this.save(next, timestamp);
        return { state: saved, report: committed };
    }
    /**
     * Build the status summary for one review.
     * @param reviewId - review id.
     * @returns summary including the resolved review directory.
     */
    async status(reviewId) {
        const state = await this.read(reviewId);
        await this.verifyPaper(state);
        const seats = state.panel.seats;
        const submitted = seats.filter(seat => seat.status === 'submitted').map(seat => seat.seat_id);
        const missing = seats.filter(seat => seat.status !== 'submitted').map(seat => seat.seat_id);
        return {
            review_id: state.review_id,
            status: state.status,
            mode: state.mode,
            paper_path: state.paper.path,
            paper_sha256: state.paper.sha256,
            seat_status: seats.map(seat => {
                const verdict = seat.report === null ? null : seat.report.verdict;
                return { seat_id: seat.seat_id, role: seat.role_marker, status: seat.status, verdict };
            }),
            required_seats: seats.map(seat => seat.seat_id),
            submitted_seats: submitted,
            missing_seats: missing,
            decision: state.synthesis.decision,
            advisory_checks: state.advisory_checks,
            pending_checkpoint: pendingCheckpointOf(state),
            review_dir: this.directoryOf(reviewId),
            warnings: state.warnings,
        };
    }
    /**
     * Run the editorial synthesis pass over the committed cards and write the
     * decision letter plus revision roadmap.
     * @param reviewId - review id.
     * @param adjudications - explicit DA CRITICAL adjudications, if already known.
     * @returns the updated record and the two written paths.
     */
    async synthesize(reviewId, adjudications) {
        const state = await this.read(reviewId);
        await this.verifyPaper(state);
        const missing = state.panel.seats.filter(seat => seat.status !== 'submitted');
        if (missing.length > 0) {
            throw new ReviewError('seats_incomplete', 'synthesis requires every panel seat to be submitted; still open: '
                + missing.map(seat => seat.seat_id).join(', '));
        }
        const timestamp = nowIso();
        const cards = state.panel.seats.map(seat => seat.report);
        const committed = [];
        for (const card of cards) {
            if (card !== null)
                committed.push(card);
        }
        const decision = decideFromVerdicts(committed.map(card => card.verdict));
        const adjudicated = normalizeAdjudications(adjudications ?? state.synthesis.da_critical_adjudications, daCriticalFindingIds(committed));
        const directory = this.directoryOf(reviewId);
        const letterPath = join(directory, state.synthesis.decision_letter_path);
        const roadmapPath = join(directory, state.synthesis.revision_roadmap_path);
        await writeTextAtomic(letterPath, renderDecisionLetter(state, committed, decision, adjudicated, timestamp));
        await writeTextAtomic(roadmapPath, renderRevisionRoadmap(state, committed, timestamp));
        const next = {
            ...state,
            status: 'awaiting_synthesis_approval',
            synthesis: {
                ...state.synthesis,
                requested_at: state.synthesis.requested_at ?? timestamp,
                completed_at: timestamp,
                decision,
                da_critical_adjudications: adjudicated,
            },
        };
        const saved = await this.save(next, timestamp);
        return { state: saved, decisionLetterPath: letterPath, roadmapPath };
    }
    /**
     * Record the human approval that closes the review.
     * @param reviewId - review id.
     * @returns the updated record.
     */
    async approveReport(reviewId) {
        const state = await this.read(reviewId);
        await this.verifyPaper(state);
        if (state.status !== 'awaiting_synthesis_approval') {
            throw new ReviewError('approval_required', 'the report can only be approved after synthesis wrote the decision letter '
                + '(status awaiting_synthesis_approval), not ' + state.status);
        }
        const unresolved = state.synthesis.da_critical_adjudications.filter(item => item.outcome === 'unresolved');
        if (unresolved.length > 0) {
            throw new ReviewError('da_adjudication_required', 'every Devil Advocate CRITICAL finding must be adjudicated visibly '
                + 'before approval; unresolved: ' + unresolved.map(item => item.finding_id).join(', '));
        }
        const timestamp = nowIso();
        const next = {
            ...state,
            status: 'report_ready',
            checkpoints: { ...state.checkpoints, report_approved_at: timestamp },
        };
        return this.save(next, timestamp);
    }
}
