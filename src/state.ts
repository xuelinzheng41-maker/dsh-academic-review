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

import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises'
import { basename, dirname, extname, join, resolve } from 'node:path'

/** Panel seats fixed by the Phase 1 port (docs/PORT_SPEC.md §2.1). */
export const SEAT_IDS = ['eic', 'methodology', 'domain', 'perspective', 'da'] as const
/** One Phase 1 review seat. */
export type SeatId = (typeof SEAT_IDS)[number]

/** Finding severities accepted from a seat report. */
export const SEVERITIES = ['critical', 'major', 'minor', 'comment'] as const
/** One finding severity. */
export type Severity = (typeof SEVERITIES)[number]

/** Per-seat verdicts accepted from a seat report. */
export const VERDICTS = ['accept', 'minor_revision', 'major_revision', 'reject'] as const
/** One per-seat verdict. */
export type Verdict = (typeof VERDICTS)[number]

/** Operational modes implemented in Phase 1. */
export const MODES = ['full', 'quick', 'methodology-focus'] as const
/** One Phase 1 review mode. */
export type ReviewMode = (typeof MODES)[number]

/** Upstream modes that exist but are not ported yet (refused, never faked). */
export const UNIMPLEMENTED_MODES = ['re-review', 'guided', 'calibration'] as const

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
] as const
/** One review lifecycle status. */
export type ReviewStatus = (typeof REVIEW_STATUSES)[number]

/** Seat lifecycle statuses. */
export const SEAT_STATUSES = ['pending', 'dispatched', 'submitted', 'failed'] as const
/** One seat lifecycle status. */
export type SeatStatus = (typeof SEAT_STATUSES)[number]

/** Advisory checker outcomes; upstream defines "not run" as a valid outcome. */
export const ADVISORY_OUTCOMES = ['not_run', 'passed', 'failed', 'skipped'] as const
/** One advisory checker outcome. */
export type AdvisoryOutcome = (typeof ADVISORY_OUTCOMES)[number]

/** Accepted manuscript extensions; PDF/DOCX are rejected, never parsed. */
export const ACCEPTED_PAPER_EXTENSIONS = ['.md', '.tex', '.txt'] as const

/** Attribution rendered into every generated report (CC BY-NC 4.0 BY term). */
export const ATTRIBUTION_LINE =
  'Unofficial DSH port of the Academic Research Skills skill "academic-paper-reviewer" '
  + 'v1.11.1 by Cheng-I Wu (https://github.com/Imbad0202/academic-research-skills, '
  + 'commit 1ec249df98728682dfbbdfb940a658338bfd6f80), CC BY-NC 4.0. '
  + 'Not affiliated with or endorsed by the upstream author.'

/** Fixed per-seat protocol facts shared by state, tools, and the prompt pack. */
export interface SeatDefinition {
  /** Stable seat id used by every tool and state file. */
  readonly seatId: SeatId
  /** Role marker the seat writes into its report (EIC / R1 / R2 / R3 / DA). */
  readonly roleMarker: string
  /** Human role name from the upstream panel. */
  readonly roleName: string
  /** Vendored upstream agent file, relative to the plugin's vendor directory. */
  readonly agentFile: string
  /** Configuration-card index for the seat; null for the fixed Devil's Advocate. */
  readonly configurationCard: number | null
}

/** Canonical seat table (upstream academic-paper-reviewer/agents/*). */
export const SEAT_DEFINITIONS: Readonly<Record<SeatId, SeatDefinition>> = {
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
}

/** Field-analysis pre-pass agent file (Phase 0). */
export const FIELD_ANALYST_AGENT_FILE = 'academic-paper-reviewer/agents/field_analyst_agent.md'
/** Editorial synthesis agent file (Phase 2). */
export const EDITORIAL_SYNTHESIZER_AGENT_FILE = 'academic-paper-reviewer/agents/editorial_synthesizer_agent.md'

/** Seats a mode requires before the panel counts as complete. */
export const MODE_SEATS: Readonly<Record<ReviewMode, readonly SeatId[]>> = {
  full: ['eic', 'methodology', 'domain', 'perspective', 'da'],
  quick: ['eic'],
  'methodology-focus': ['eic', 'methodology'],
}

/** One evidence quote pinned to a manuscript location. */
export interface ReviewEvidence {
  /** Verbatim manuscript text the finding rests on. */
  readonly quote: string
  /** Section/line locator inside the manuscript. */
  readonly location: string
}

/** One finding emitted by a seat. */
export interface ReviewFinding {
  /** Seat-local finding id, e.g. eic-F1. */
  readonly id: string
  /** Closed severity enum. */
  readonly severity: Severity
  /** Short finding title. */
  readonly title: string
  /** Full finding text. */
  readonly detail: string
  /** At least one quote + location; a claim without evidence is refused. */
  readonly evidence: readonly ReviewEvidence[]
}

/** Provenance recorded per seat (honest role separation, never "independence"). */
export interface SeatProvenance {
  /** Model or route that produced the card. */
  readonly model?: string
  /** Whether any peer card was visible to this seat; must be false in Phase 1. */
  readonly peerOutputVisible?: boolean
  /** Whether the seat ran in a fresh context. */
  readonly contextFresh?: boolean
  /** Human who operated the run, when known. */
  readonly humanOperator?: string
}

/** One committed seat report (the shape of seats/<seat_id>.json). */
export interface SeatReport {
  /** Schema version of the report envelope. */
  readonly schema_version: '1'
  /** Owning review id. */
  readonly review_id: string
  /** Seat the report belongs to. */
  readonly seat_id: SeatId
  /** Role marker copied from SEAT_DEFINITIONS. */
  readonly role: string
  /** Creation timestamp supplied by the submitter (ISO-8601 with offset). */
  readonly created_at: string
  /** Commit timestamp assigned by the plugin. */
  readonly submitted_at: string
  /** Per-seat verdict. */
  readonly verdict: Verdict
  /** Reviewer confidence in [0, 1]. */
  readonly confidence: number
  /** Prose summary of the card. */
  readonly summary?: string
  /** Findings with evidence. */
  readonly findings: readonly ReviewFinding[]
  /** Provenance of the run that produced the card. */
  readonly provenance?: SeatProvenance
}

/** One panel seat in the durable review record. */
export interface PanelSeat {
  /** Seat id. */
  readonly seat_id: SeatId
  /** Role marker. */
  readonly role_marker: string
  /** Vendored agent file path, relative to the plugin vendor directory. */
  readonly agent_file: string
  /** Seat lifecycle status. */
  status: SeatStatus
  /** Dispatch timestamp, or null before dispatch. */
  dispatched_at: string | null
  /** Commit timestamp, or null before submission. */
  submitted_at: string | null
  /** Configuration-card index, or null for the Devil's Advocate. */
  readonly configuration_card: number | null
  /** Committed report, or null while the seat is open. */
  report: SeatReport | null
}

/** One Reviewer Configuration Card produced by the field analyst. */
export interface ConfigurationCard {
  seat: SeatId
  identity: string
  expertise: string
  focus: string
}

/** Phase 0 field analysis output. */
export interface FieldAnalysis {
  /** When the analyst pass ran. */
  analyst_run_at: string
  /** Primary discipline. */
  primary_discipline: string
  /** Secondary disciplines. */
  secondary_disciplines: string[]
  /** Research paradigm. */
  research_paradigm: string
  /** Methodology type. */
  methodology_type: string
  /** Target journal tier. */
  target_journal_tier: string
  /** Paper maturity. */
  paper_maturity: string
  /** The four Reviewer Configuration Cards (the Devil's Advocate has none). */
  configuration_cards: ConfigurationCard[]
}

/** One visible adjudication of a Devil's Advocate CRITICAL finding. */
export interface DevilsAdvocateAdjudication {
  /** Finding id being adjudicated. */
  finding_id: string
  /** Adjudication outcome. */
  outcome: 'validated' | 'rejected' | 'unresolved'
  /** Reasoning shown in the decision letter. */
  rationale: string
}

/** Editorial synthesis slot of the review record. */
export interface SynthesisRecord {
  /** When the synthesizer pass was requested. */
  requested_at: string | null
  /** When the decision letter and roadmap were written. */
  completed_at: string | null
  /** Advisory decision derived from the committed cards. */
  decision: Verdict | null
  /** Decision letter path, relative to the review directory. */
  decision_letter_path: string
  /** Revision roadmap path, relative to the review directory. */
  revision_roadmap_path: string
  /** DA CRITICAL adjudications carried into the letter. */
  da_critical_adjudications: DevilsAdvocateAdjudication[]
}

/** Human checkpoints recorded by the plugin. */
export interface CheckpointRecord {
  /** Set when the user confirmed or edited the configuration cards. */
  panel_confirmed_at: string | null
  /** Set when the user approved the final report. */
  report_approved_at: string | null
}

/** Paper pinning block of the review record. */
export interface PaperRecord {
  /** Absolute manuscript path. */
  path: string
  /** SHA-256 of the manuscript bytes at create time. */
  sha256: string
  /** Size in bytes. */
  bytes: number
  /** Accepted format without the dot. */
  format: string
}

/** The durable review record stored in state.json. */
export interface ReviewState {
  /** Schema version of the record. */
  readonly schema_version: '1'
  /** Review id, also the review directory name. */
  readonly review_id: string
  /** Creation timestamp. */
  readonly created_at: string
  /** Last mutation timestamp. */
  updated_at: string
  /** Phase 1 mode. */
  readonly mode: ReviewMode
  /** Pinned manuscript. */
  readonly paper: PaperRecord
  /** Vendored upstream skill version. */
  readonly upstream_skill_version: string
  /** Vendored upstream commit. */
  readonly upstream_commit: string
  /** Lifecycle status. */
  status: ReviewStatus
  /** Phase 0 output, null until the analyst pass is attached. */
  field_analysis: FieldAnalysis | null
  /** Panel seats. */
  panel: { seats: PanelSeat[] }
  /** Editorial synthesis slot. */
  synthesis: SynthesisRecord
  /** Human checkpoints. */
  checkpoints: CheckpointRecord
  /** Advisory checker outcomes. */
  advisory_checks: Record<string, AdvisoryOutcome>
  /** Non-fatal warnings raised during the run (e.g. oversized manuscript). */
  warnings: string[]
}

/** Stable error codes surfaced to the model instead of raw stack traces. */
export type ReviewErrorCode =
  | 'review_not_found'
  | 'invalid_state'
  | 'invalid_mode'
  | 'invalid_seat_id'
  | 'invalid_report'
  | 'unsupported_format'
  | 'paper_unreadable'
  | 'paper_changed'
  | 'duplicate_submission'
  | 'panel_not_confirmed'
  | 'seats_incomplete'
  | 'da_adjudication_required'
  | 'state_conflict'
  | 'approval_required'

/** Error carrying a machine-readable review failure code. */
export class ReviewError extends Error {
  /** Failure code the tool layer renders verbatim. */
  readonly code: ReviewErrorCode

  constructor(code: ReviewErrorCode, message: string) {
    super(message)
    this.name = 'ReviewError'
    this.code = code
  }
}

/** Store configuration resolved from the plugin config. */
export interface ReviewStoreConfig {
  /** Workspace root the review directory lives under. */
  readonly workspace: string
  /** Review-state directory name, default .academic-review. */
  readonly stateDir?: string
  /** Oversize warning threshold in bytes, default 1 MiB. */
  readonly maxPaperBytes?: number
  /** Vendored upstream skill version recorded in each review. */
  readonly upstreamSkillVersion?: string
  /** Vendored upstream commit recorded in each review. */
  readonly upstreamCommit?: string
}

/** Input accepted by ReviewStore.create. */
export interface CreateReviewInput {
  /** Manuscript path: .md, .tex, or .txt. */
  readonly paperPath: string
  /** Phase 1 mode, default full. */
  readonly mode?: string
}

/** Summary shape returned by academic_review_status. */
export interface ReviewStatusSummary {
  review_id: string
  status: ReviewStatus
  mode: ReviewMode
  paper_path: string
  paper_sha256: string
  seat_status: { seat_id: SeatId; role: string; status: SeatStatus; verdict: Verdict | null }[]
  required_seats: SeatId[]
  submitted_seats: SeatId[]
  missing_seats: SeatId[]
  decision: Verdict | null
  advisory_checks: Record<string, AdvisoryOutcome>
  pending_checkpoint: string | null
  review_dir: string
  warnings: string[]
}

/** Result of a synthesis pass. */
export interface SynthesisOutcome {
  state: ReviewState
  decisionLetterPath: string
  roadmapPath: string
}

const DEFAULT_STATE_DIR = '.academic-review'
const DEFAULT_MAX_PAPER_BYTES = 1024 * 1024
const DEFAULT_UPSTREAM_SKILL_VERSION = '1.11.1'
const DEFAULT_UPSTREAM_COMMIT = '1ec249df98728682dfbbdfb940a658338bfd6f80'
const RENAME_RETRIES = 3
const RENAME_RETRY_DELAY_MS = 50
const ISO_WITH_OFFSET = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/

/** Current time as ISO-8601 with the local UTC offset (never a bare Z). */
export function nowIso(date: Date = new Date()): string {
  const pad = (value: number, width = 2): string => String(Math.abs(value)).padStart(width, '0')
  const offsetMinutes = -date.getTimezoneOffset()
  const sign = offsetMinutes >= 0 ? '+' : '-'
  const hours = pad(Math.trunc(Math.abs(offsetMinutes) / 60))
  const minutes = pad(Math.abs(offsetMinutes) % 60)
  return String(date.getFullYear()) + '-' + pad(date.getMonth() + 1) + '-' + pad(date.getDate())
    + 'T' + pad(date.getHours()) + ':' + pad(date.getMinutes()) + ':' + pad(date.getSeconds())
    + sign + hours + ':' + minutes
}

/** Whether a string is an ISO-8601 timestamp with an explicit offset. */
export function isIsoTimestamp(value: unknown): value is string {
  return typeof value === 'string' && ISO_WITH_OFFSET.test(value)
}

/** SHA-256 hex digest of a buffer. */
export function sha256Of(buffer: Uint8Array): string {
  return createHash('sha256').update(buffer).digest('hex')
}

/** Whether a value is a Phase 1 seat id. */
export function isSeatId(value: unknown): value is SeatId {
  return typeof value === 'string' && (SEAT_IDS as readonly string[]).includes(value)
}

/** Whether a value is an implemented Phase 1 mode. */
export function isReviewMode(value: unknown): value is ReviewMode {
  return typeof value === 'string' && (MODES as readonly string[]).includes(value)
}

/**
 * Resolve one review root directory.
 * @param config - store configuration.
 * @returns absolute review-root path.
 */
export function reviewRootOf(config: ReviewStoreConfig): string {
  const stateDir = (config.stateDir ?? DEFAULT_STATE_DIR).trim()
  return resolve(config.workspace, stateDir === '' ? DEFAULT_STATE_DIR : stateDir)
}

/**
 * Resolve one review directory.
 * @param config - store configuration.
 * @param reviewId - review id.
 * @returns absolute review directory path.
 */
export function reviewDirOf(config: ReviewStoreConfig, reviewId: string): string {
  if (!/^[A-Za-z0-9._-]+$/.test(reviewId)) {
    throw new ReviewError('review_not_found', 'invalid review id "' + reviewId + '"')
  }
  return join(reviewRootOf(config), reviewId)
}

/**
 * Reject a manuscript path whose extension Phase 1 cannot read.
 * @param paperPath - caller-supplied manuscript path.
 * @returns the normalized lowercase extension without the dot.
 */
export function requireSupportedFormat(paperPath: string): string {
  const extension = extname(paperPath).toLowerCase()
  if (extension === '.pdf') {
    throw new ReviewError(
      'unsupported_format',
      'PDF manuscripts are not supported by this Phase 1 port (no PDF parsing, no OCR). '
      + 'Extract the text to .md, .tex, or .txt and create the review again.',
    )
  }
  if (!(ACCEPTED_PAPER_EXTENSIONS as readonly string[]).includes(extension)) {
    throw new ReviewError(
      'unsupported_format',
      'unsupported manuscript format "' + (extension === '' ? '(none)' : extension) + '": this port accepts '
      + ACCEPTED_PAPER_EXTENSIONS.join(', ') + ' only',
    )
  }
  return extension.slice(1)
}

/**
 * Write text through a temp file plus same-directory rename, falling back to an
 * in-place write when a transient Windows lock keeps the target open.
 * @param file - target path.
 * @param text - exact file content.
 */
export async function writeTextAtomic(file: string, text: string): Promise<void> {
  const directory = dirname(file)
  await mkdir(directory, { recursive: true })
  const temporary = join(directory, '.' + basename(file) + '.' + String(process.pid) + '.' + randomUUID() + '.tmp')
  await writeFile(temporary, text, 'utf8')
  for (let attempt = 0; ; attempt += 1) {
    try {
      await rename(temporary, file)
      return
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code ?? ''
      const retryable = code === 'EPERM' || code === 'EACCES' || code === 'EBUSY'
        || code === 'EEXIST' || code === 'ENOTEMPTY'
      if (retryable && attempt < RENAME_RETRIES) {
        await new Promise<void>(resolveDelay => { setTimeout(resolveDelay, RENAME_RETRY_DELAY_MS) })
        continue
      }
      try {
        await writeFile(file, text, 'utf8')
      } finally {
        await unlink(temporary).catch(() => undefined)
      }
      return
    }
  }
}

/**
 * Write a value as JSON through an atomic replace.
 * @param file - target path.
 * @param value - losslessly serializable value.
 */
export async function writeJsonAtomic(file: string, value: unknown): Promise<void> {
  await writeTextAtomic(file, JSON.stringify(value, null, 2) + '\n')
}

/** Validate one evidence entry, throwing a path-qualified ReviewError. */
function validateEvidence(value: unknown, path: string): ReviewEvidence {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new ReviewError('invalid_report', path + ' must be an object with quote and location')
  }
  const record = value as Record<string, unknown>
  if (typeof record.quote !== 'string' || record.quote.trim() === '') {
    throw new ReviewError('invalid_report', path + '.quote must be a non-empty string')
  }
  if (typeof record.location !== 'string' || record.location.trim() === '') {
    throw new ReviewError('invalid_report', path + '.location must be a non-empty string (section/line locator)')
  }
  return { quote: record.quote, location: record.location }
}

/** Validate one finding, throwing a path-qualified ReviewError. */
function validateFinding(value: unknown, path: string): ReviewFinding {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new ReviewError('invalid_report', path + ' must be an object')
  }
  const record = value as Record<string, unknown>
  if (typeof record.id !== 'string' || record.id.trim() === '') {
    throw new ReviewError('invalid_report', path + '.id must be a non-empty string')
  }
  if (typeof record.severity !== 'string' || !(SEVERITIES as readonly string[]).includes(record.severity)) {
    throw new ReviewError('invalid_report', path + '.severity must be one of ' + SEVERITIES.join('|'))
  }
  if (typeof record.title !== 'string' || record.title.trim() === '') {
    throw new ReviewError('invalid_report', path + '.title must be a non-empty string')
  }
  if (typeof record.detail !== 'string' || record.detail.trim() === '') {
    throw new ReviewError('invalid_report', path + '.detail must be a non-empty string')
  }
  if (!Array.isArray(record.evidence) || record.evidence.length === 0) {
    throw new ReviewError('invalid_report', path + '.evidence must list at least one { quote, location } entry')
  }
  const evidence = record.evidence.map((item: unknown, index: number) => validateEvidence(item, path + '.evidence[' + String(index) + ']'))
  return {
    id: record.id,
    severity: record.severity as Severity,
    title: record.title,
    detail: record.detail,
    evidence,
  }
}

/** Validated report content without commit metadata. */
export type SeatReportBody = Omit<SeatReport, 'schema_version' | 'review_id' | 'seat_id' | 'role' | 'submitted_at'>

/**
 * Validate a submitter-supplied seat report body and normalize it.
 * @param value - raw report argument from the submit tool.
 * @param seatId - seat the report is offered for.
 * @param role - expected role marker.
 * @returns the validated report content without commit metadata.
 */
export function validateSeatReportBody(value: unknown, seatId: SeatId, role: string): SeatReportBody {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new ReviewError('invalid_report', 'report must be an object')
  }
  const record = value as Record<string, unknown>
  if (record.seat_id !== undefined && record.seat_id !== seatId) {
    throw new ReviewError('invalid_seat_id', 'report.seat_id "' + String(record.seat_id) + '" does not match seat "' + seatId + '"')
  }
  if (record.role !== undefined && record.role !== role) {
    throw new ReviewError('invalid_report', 'report.role must be the seat role marker "' + role + '"')
  }
  if (typeof record.verdict !== 'string' || !(VERDICTS as readonly string[]).includes(record.verdict)) {
    throw new ReviewError('invalid_report', 'report.verdict must be one of ' + VERDICTS.join('|'))
  }
  if (typeof record.confidence !== 'number' || !Number.isFinite(record.confidence)
    || record.confidence < 0 || record.confidence > 1) {
    throw new ReviewError('invalid_report', 'report.confidence must be a number between 0 and 1')
  }
  if (!isIsoTimestamp(record.created_at)) {
    throw new ReviewError('invalid_report', 'report.created_at must be an ISO-8601 timestamp with an explicit UTC offset')
  }
  if (!Array.isArray(record.findings)) {
    throw new ReviewError('invalid_report', 'report.findings must be an array')
  }
  const findings = record.findings.map((item: unknown, index: number) => validateFinding(item, 'report.findings[' + String(index) + ']'))
  const seen = new Set<string>()
  for (const finding of findings) {
    if (seen.has(finding.id)) {
      throw new ReviewError('invalid_report', 'duplicate finding id "' + finding.id + '" in one report')
    }
    seen.add(finding.id)
  }
  if (record.summary !== undefined && typeof record.summary !== 'string') {
    throw new ReviewError('invalid_report', 'report.summary must be a string when present')
  }
  let provenance: SeatProvenance | undefined
  if (record.provenance !== undefined) {
    if (typeof record.provenance !== 'object' || record.provenance === null || Array.isArray(record.provenance)) {
      throw new ReviewError('invalid_report', 'report.provenance must be an object when present')
    }
    const raw = record.provenance as Record<string, unknown>
    const normalized: SeatProvenance = {}
    if (raw.model !== undefined) {
      if (typeof raw.model !== 'string') throw new ReviewError('invalid_report', 'report.provenance.model must be a string')
      ;(normalized as { model?: string }).model = raw.model
    }
    if (raw.peerOutputVisible !== undefined) {
      if (typeof raw.peerOutputVisible !== 'boolean') throw new ReviewError('invalid_report', 'report.provenance.peerOutputVisible must be a boolean')
      ;(normalized as { peerOutputVisible?: boolean }).peerOutputVisible = raw.peerOutputVisible
    }
    if (raw.contextFresh !== undefined) {
      if (typeof raw.contextFresh !== 'boolean') throw new ReviewError('invalid_report', 'report.provenance.contextFresh must be a boolean')
      ;(normalized as { contextFresh?: boolean }).contextFresh = raw.contextFresh
    }
    if (raw.humanOperator !== undefined) {
      if (typeof raw.humanOperator !== 'string') throw new ReviewError('invalid_report', 'report.provenance.humanOperator must be a string')
      ;(normalized as { humanOperator?: string }).humanOperator = raw.humanOperator
    }
    provenance = normalized
  }
  if (provenance !== undefined && provenance.peerOutputVisible === true) {
    throw new ReviewError(
      'invalid_report',
      'report.provenance.peerOutputVisible must be false: Phase 1 seats commit without seeing peer cards (Iron Rule #2)',
    )
  }
  const body: SeatReportBody = {
    created_at: record.created_at,
    verdict: record.verdict as Verdict,
    confidence: record.confidence,
    findings,
    ...(record.summary === undefined ? {} : { summary: record.summary }),
    ...(provenance === undefined ? {} : { provenance }),
  }
  return body
}

/**
 * Validate a persisted review record read back from disk.
 * @param value - parsed JSON.
 * @param reviewId - directory-derived review id.
 * @returns the validated record.
 */
export function validateReviewState(value: unknown, reviewId: string): ReviewState {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new ReviewError('invalid_state', 'review "' + reviewId + '" state.json is not an object')
  }
  const state = value as ReviewState
  if (state.schema_version !== '1') {
    throw new ReviewError('invalid_state', 'review "' + reviewId + '" has unsupported schema_version')
  }
  if (state.review_id !== reviewId) {
    throw new ReviewError('invalid_state', 'review "' + reviewId + '" state.json declares review_id "' + String(state.review_id) + '"')
  }
  if (!isReviewMode(state.mode)) {
    throw new ReviewError('invalid_state', 'review "' + reviewId + '" has invalid mode')
  }
  if (!(REVIEW_STATUSES as readonly string[]).includes(state.status)) {
    throw new ReviewError('invalid_state', 'review "' + reviewId + '" has invalid status')
  }
  if (!Array.isArray(state.panel?.seats)) {
    throw new ReviewError('invalid_state', 'review "' + reviewId + '" state.json has no panel.seats array')
  }
  if (typeof state.paper?.sha256 !== 'string' || !/^[0-9a-f]{64}$/.test(state.paper.sha256)) {
    throw new ReviewError('invalid_state', 'review "' + reviewId + '" has no valid paper.sha256 pin')
  }
  return state
}

/** Collapse a quote onto one Markdown bullet. */
function quoteForMarkdown(quote: string): string {
  const single = quote.replace(/\s+/g, ' ').trim()
  return single.length > 280 ? single.slice(0, 277) + '...' : single
}

/**
 * Render one committed seat report as Markdown (the seats/<seat>.md copy).
 * @param report - committed report.
 * @param roleName - human role name for the heading.
 * @returns Markdown document.
 */
export function renderSeatMarkdown(report: SeatReport, roleName: string): string {
  const lines: string[] = [
    '# Review card - ' + report.role + ' (' + roleName + ')',
    '',
    '- Review: ' + report.review_id,
    '- Seat: ' + report.seat_id + ' (role marker ' + report.role + ')',
    '- Verdict: ' + report.verdict,
    '- Confidence: ' + report.confidence.toFixed(2),
    '- Created: ' + report.created_at,
    '- Committed: ' + report.submitted_at,
    '',
  ]
  if (report.summary !== undefined && report.summary.trim() !== '') {
    lines.push('## Summary', '', report.summary.trim(), '')
  }
  lines.push('## Findings', '')
  if (report.findings.length === 0) {
    lines.push('_No findings were recorded by this seat._', '')
  }
  for (const finding of report.findings) {
    lines.push('### ' + finding.id + ' - ' + finding.title + ' [' + finding.severity + ']', '', finding.detail.trim(), '', 'Evidence:', '')
    for (const evidence of finding.evidence) {
      lines.push('- at ' + evidence.location + ': ' + quoteForMarkdown(evidence.quote))
    }
    lines.push('')
  }
  if (report.provenance !== undefined) {
    lines.push('## Provenance', '')
    lines.push('- peer_output_visible: ' + String(report.provenance.peerOutputVisible ?? false)
      + ' (role separation is not independence)')
    if (report.provenance.model !== undefined) lines.push('- model: ' + report.provenance.model)
    if (report.provenance.contextFresh !== undefined) lines.push('- context_fresh: ' + String(report.provenance.contextFresh))
    if (report.provenance.humanOperator !== undefined) lines.push('- human_operator: ' + report.provenance.humanOperator)
    lines.push('')
  }
  lines.push('---', '', ATTRIBUTION_LINE, '')
  return lines.join('\n')
}

/**
 * Aggregate per-seat verdicts into one advisory decision.
 * The modal verdict wins; a tie resolves toward the more severe verdict.
 * @param verdicts - committed per-seat verdicts.
 * @returns the advisory decision, or null with no verdicts.
 */
export function decideFromVerdicts(verdicts: readonly Verdict[]): Verdict | null {
  if (verdicts.length === 0) return null
  const counts = new Map<Verdict, number>()
  for (const verdict of verdicts) counts.set(verdict, (counts.get(verdict) ?? 0) + 1)
  const severityOrder: readonly Verdict[] = ['reject', 'major_revision', 'minor_revision', 'accept']
  let best: Verdict = 'reject'
  let bestCount = -1
  for (const verdict of severityOrder) {
    const count = counts.get(verdict) ?? 0
    if (count > bestCount) {
      best = verdict
      bestCount = count
    }
  }
  return best
}

/** Count findings per severity for one card. */
function countSeverities(card: SeatReport): Record<Severity, number> {
  const counts: Record<Severity, number> = { critical: 0, major: 0, minor: 0, comment: 0 }
  for (const finding of card.findings) counts[finding.severity] += 1
  return counts
}

/** Finding titles raised by more than one seat. */
function repeatedFindingTitles(cards: readonly SeatReport[]): { title: string; seats: string[] }[] {
  const map = new Map<string, string[]>()
  for (const card of cards) {
    for (const finding of card.findings) {
      const key = finding.title.trim().toLowerCase()
      const seats = map.get(key) ?? []
      if (!seats.includes(card.role)) seats.push(card.role)
      map.set(key, seats)
    }
  }
  return [...map.entries()]
    .filter(entry => entry[1].length > 1)
    .map(entry => ({ title: entry[0], seats: entry[1] }))
}

/**
 * Every Devil's Advocate CRITICAL finding id across the committed cards.
 * @param cards - committed cards.
 * @returns finding ids in seat/finding order.
 */
export function daCriticalFindingIds(cards: readonly SeatReport[]): string[] {
  const ids: string[] = []
  for (const card of cards) {
    if (card.seat_id !== 'da') continue
    for (const finding of card.findings) {
      if (finding.severity === 'critical') ids.push(finding.id)
    }
  }
  return ids
}

/** Validate and complete the DA CRITICAL adjudication table. */
function normalizeAdjudications(
  adjudications: readonly DevilsAdvocateAdjudication[],
  required: readonly string[],
): DevilsAdvocateAdjudication[] {
  const byId = new Map<string, DevilsAdvocateAdjudication>()
  for (const item of adjudications) {
    if (typeof item.finding_id !== 'string' || item.finding_id.trim() === '') {
      throw new ReviewError('invalid_report', 'each adjudication needs a non-empty finding_id')
    }
    if (item.outcome !== 'validated' && item.outcome !== 'rejected' && item.outcome !== 'unresolved') {
      throw new ReviewError('invalid_report', 'adjudication outcome for "' + item.finding_id + '" must be validated|rejected|unresolved')
    }
    if (typeof item.rationale !== 'string' || item.rationale.trim() === '') {
      throw new ReviewError('invalid_report', 'adjudication for "' + item.finding_id + '" needs a rationale')
    }
    byId.set(item.finding_id, { finding_id: item.finding_id, outcome: item.outcome, rationale: item.rationale })
  }
  const completed: DevilsAdvocateAdjudication[] = []
  for (const findingId of required) {
    completed.push(byId.get(findingId) ?? {
      finding_id: findingId,
      outcome: 'unresolved',
      rationale: "Not adjudicated yet: the synthesizer may not invent an outcome for a Devil's Advocate CRITICAL finding.",
    })
  }
  for (const entry of byId) {
    if (!required.includes(entry[0])) completed.push(entry[1])
  }
  return completed
}

/**
 * The checkpoint a caller is waiting on, or null.
 * @param state - review record.
 * @returns checkpoint name.
 */
export function pendingCheckpointOf(state: ReviewState): string | null {
  switch (state.status) {
    case 'created':
    case 'panel_configured':
      return 'field_analysis_attachment'
    case 'awaiting_panel_confirmation':
      return 'panel_confirmation'
    case 'awaiting_synthesis_approval':
      return 'report_approval'
    default:
      return null
  }
}

/** Render the editorial decision letter. */
function renderDecisionLetter(
  state: ReviewState,
  cards: readonly SeatReport[],
  decision: Verdict | null,
  adjudications: readonly DevilsAdvocateAdjudication[],
  timestamp: string,
): string {
  const lines: string[] = [
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
  ]
  for (const card of cards) {
    const counts = countSeverities(card)
    lines.push('| ' + card.seat_id + ' | ' + card.role + ' | ' + card.verdict + ' | '
      + card.confidence.toFixed(2) + ' | ' + String(counts.critical) + '/' + String(counts.major) + '/'
      + String(counts.minor) + '/' + String(counts.comment) + ' |')
  }
  lines.push('', '## 2. Consensus and disagreement', '')
  const agreeing = cards.filter(card => card.verdict === decision)
  const dissenting = cards.filter(card => card.verdict !== decision)
  lines.push('- Agreeing with the advisory decision: ' + (agreeing.length === 0
    ? '(none)'
    : agreeing.map(card => card.role + ' (' + card.verdict + ')').join(', ')))
  lines.push('- Dissenting: ' + (dissenting.length === 0
    ? '(none)'
    : dissenting.map(card => card.role + ' (' + card.verdict + ')').join(', ')))
  lines.push('')
  const repeated = repeatedFindingTitles(cards)
  if (repeated.length > 0) {
    lines.push('Findings raised by more than one seat (same title, a cross-seat attention signal):', '')
    for (const entry of repeated) lines.push('- ' + entry.title + ' - ' + entry.seats.join(', '))
    lines.push('')
  } else {
    lines.push('No finding title was raised by more than one seat.', '')
  }
  lines.push('## 3. Devil Advocate CRITICAL adjudication', '')
  if (adjudications.length === 0) {
    lines.push('No Devil Advocate CRITICAL finding was raised, so nothing needed adjudication.', '')
  } else {
    for (const item of adjudications) {
      lines.push('- ' + item.finding_id + ': ' + item.outcome + ' - ' + item.rationale)
    }
    lines.push('')
  }
  lines.push('## 4. Per-seat findings', '')
  for (const card of cards) {
    lines.push('### ' + card.role + ' - ' + card.verdict, '')
    if (card.findings.length === 0) {
      lines.push('_No findings._', '')
      continue
    }
    for (const finding of card.findings) {
      lines.push('- ' + finding.id + ' [' + finding.severity + '] ' + finding.title)
      lines.push('  - ' + finding.detail.trim())
      for (const evidence of finding.evidence) {
        lines.push('  - evidence at ' + evidence.location + ': ' + quoteForMarkdown(evidence.quote))
      }
    }
    lines.push('')
  }
  lines.push(
    '## 5. Decision',
    '',
    'Advisory decision: ' + (decision ?? 'undetermined') + '.',
    '',
    'Delivering this letter requires explicit human approval (human checkpoint 2,',
    'docs/PORT_SPEC.md section 4.4). The plugin never approves its own output.',
    '',
    '---',
    '',
    ATTRIBUTION_LINE,
    '',
  )
  return lines.join('\n')
}

/** Render the non-ranking revision roadmap. */
function renderRevisionRoadmap(state: ReviewState, cards: readonly SeatReport[], timestamp: string): string {
  const lines: string[] = [
    '# Revision Roadmap (advisory, non-ranking)',
    '',
    '- Review: ' + state.review_id,
    '- Manuscript SHA-256: ' + state.paper.sha256,
    '- Generated: ' + timestamp,
    '',
    'Items are grouped by severity and listed in seat order. That order is not a',
    'priority ranking and implies no schedule; the authors decide what to act on.',
    '',
  ]
  const order: readonly Severity[] = ['critical', 'major', 'minor', 'comment']
  for (const severity of order) {
    const items: string[] = []
    for (const card of cards) {
      for (const finding of card.findings) {
        if (finding.severity !== severity) continue
        const location = finding.evidence[0] === undefined ? 'no location' : finding.evidence[0].location
        items.push('- [' + card.role + '] ' + finding.id + ' - ' + finding.title + ' (at ' + location + ')')
      }
    }
    lines.push('## ' + severity + ' (' + String(items.length) + ')', '')
    if (items.length === 0) lines.push('_none_', '')
    else lines.push(...items, '')
  }
  lines.push('---', '', ATTRIBUTION_LINE, '')
  return lines.join('\n')
}

/** A review-state store bound to one workspace. */
export class ReviewStore {
  /** Resolved configuration. */
  readonly config: ReviewStoreConfig
  /** Resolved review root directory. */
  readonly root: string
  /** Oversize warning threshold in bytes. */
  readonly maxPaperBytes: number

  constructor(config: ReviewStoreConfig) {
    this.config = { ...config }
    this.root = reviewRootOf(config)
    this.maxPaperBytes = config.maxPaperBytes ?? DEFAULT_MAX_PAPER_BYTES
  }

  /**
   * Absolute directory of one review.
   * @param reviewId - review id.
   * @returns absolute path.
   */
  directoryOf(reviewId: string): string {
    return reviewDirOf(this.config, reviewId)
  }

  /**
   * Absolute state.json path of one review.
   * @param reviewId - review id.
   * @returns absolute path.
   */
  statePathOf(reviewId: string): string {
    return join(this.directoryOf(reviewId), 'state.json')
  }

  /**
   * Absolute seat-report path of one review.
   * @param reviewId - review id.
   * @param seatId - seat id.
   * @returns absolute path.
   */
  seatPathOf(reviewId: string, seatId: SeatId): string {
    return join(this.directoryOf(reviewId), 'seats', seatId + '.json')
  }

  /**
   * Create a review for one manuscript.
   * @param input - manuscript path plus optional mode.
   * @returns the freshly written record.
   */
  async create(input: CreateReviewInput): Promise<ReviewState> {
    const mode = input.mode === undefined || input.mode.trim() === '' ? 'full' : input.mode.trim()
    if (!isReviewMode(mode)) {
      const hint = (UNIMPLEMENTED_MODES as readonly string[]).includes(mode)
        ? ' - that upstream mode is not implemented in this Phase 1 port and changes no state'
        : ''
      throw new ReviewError('invalid_mode', 'unsupported review mode "' + mode + '"' + hint
        + '; use one of ' + MODES.join('|'))
    }
    const paperPath = resolve(input.paperPath)
    const format = requireSupportedFormat(paperPath)
    let bytes: Buffer
    try {
      bytes = await readFile(paperPath)
    } catch (error) {
      throw new ReviewError('paper_unreadable', 'cannot read manuscript "' + paperPath + '": ' + (error as Error).message)
    }
    const timestamp = nowIso()
    const reviewId = 'rev-' + timestamp.slice(0, 10).replace(/-/g, '') + '-' + randomBytes(4).toString('hex')
    const warnings: string[] = []
    if (bytes.byteLength > this.maxPaperBytes) {
      warnings.push('manuscript is ' + String(bytes.byteLength) + ' bytes, above the '
        + String(this.maxPaperBytes) + '-byte seat-context budget; seats must read it in sections and '
        + 'must not truncate silently (docs/PORT_SPEC.md section 4.8)')
    }
    const requiredSeats = MODE_SEATS[mode]
    const state: ReviewState = {
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
          const definition = SEAT_DEFINITIONS[seatId]
          const seat: PanelSeat = {
            seat_id: seatId,
            role_marker: definition.roleMarker,
            agent_file: definition.agentFile,
            status: 'pending',
            dispatched_at: null,
            submitted_at: null,
            configuration_card: definition.configurationCard,
            report: null,
          }
          return seat
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
    }
    const directory = this.directoryOf(reviewId)
    await mkdir(join(directory, 'seats'), { recursive: true })
    await writeJsonAtomic(join(directory, 'state.json'), state)
    return state
  }

  /**
   * Read one review record.
   * @param reviewId - review id.
   * @returns validated record.
   */
  async read(reviewId: string): Promise<ReviewState> {
    const path = this.statePathOf(reviewId)
    let raw: string
    try {
      raw = await readFile(path, 'utf8')
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        throw new ReviewError('review_not_found', 'review "' + reviewId + '" was not found under ' + this.root)
      }
      throw new ReviewError('invalid_state', 'cannot read ' + path + ': ' + (error as Error).message)
    }
    let value: unknown
    try {
      value = JSON.parse(raw.replace(/^\uFEFF/, ''))
    } catch (error) {
      throw new ReviewError('invalid_state', 'review "' + reviewId + '" state.json is not valid JSON: ' + (error as Error).message)
    }
    return validateReviewState(value, reviewId)
  }

  /**
   * Recompute the manuscript digest and fail when the bytes changed.
   * @param state - record whose paper block is pinned.
   * @returns the verified digest.
   */
  async verifyPaper(state: ReviewState): Promise<string> {
    let bytes: Buffer
    try {
      bytes = await readFile(state.paper.path)
    } catch (error) {
      throw new ReviewError('paper_unreadable', 'cannot re-read manuscript "' + state.paper.path + '": ' + (error as Error).message)
    }
    const digest = sha256Of(bytes)
    if (digest !== state.paper.sha256) {
      throw new ReviewError('paper_changed', 'manuscript "' + state.paper.path + '" changed during the review (pinned '
        + state.paper.sha256 + ', now ' + digest + '). Start a new review for the revised manuscript.')
    }
    return digest
  }

  /** Persist a mutated record with a refreshed updated_at. */
  private async save(state: ReviewState, timestamp: string = nowIso()): Promise<ReviewState> {
    const next: ReviewState = { ...state, updated_at: timestamp }
    await writeJsonAtomic(this.statePathOf(next.review_id), next)
    return next
  }

  /** Locate one seat inside a record. */
  private seatOf(state: ReviewState, seatId: SeatId): PanelSeat {
    const seat = state.panel.seats.find(item => item.seat_id === seatId)
    if (seat === undefined) {
      const panel = state.panel.seats.map(item => item.seat_id).join('|')
      throw new ReviewError('invalid_seat_id', 'seat "' + seatId + '" is not part of this ' + state.mode
        + ' review panel (seats: ' + panel + ')')
    }
    return seat
  }

  /**
   * Attach the Phase 0 field analysis and open the panel-confirmation checkpoint.
   * @param reviewId - review id.
   * @param analysis - analyst output, including the four configuration cards.
   * @returns the updated record.
   */
  async attachFieldAnalysis(reviewId: string, analysis: FieldAnalysis): Promise<ReviewState> {
    const state = await this.read(reviewId)
    await this.verifyPaper(state)
    if (state.status !== 'created' && state.status !== 'panel_configured') {
      throw new ReviewError('state_conflict', 'field analysis can only be attached from status created|panel_configured, not ' + state.status)
    }
    const cards = analysis.configuration_cards
    const cardSeats = state.panel.seats.filter(seat => seat.seat_id !== 'da').map(seat => seat.seat_id)
    if (!Array.isArray(cards) || cards.length !== cardSeats.length) {
      throw new ReviewError('invalid_state', 'field_analysis.configuration_cards must contain exactly '
        + String(cardSeats.length) + ' card(s) for this ' + state.mode + ' panel ('
        + cardSeats.join('|') + '); the Devil Advocate seat takes no card')
    }
    for (const card of cards) {
      if (!isSeatId(card.seat) || card.seat === 'da') {
        throw new ReviewError('invalid_state', 'configuration card seat "' + String(card.seat)
          + '" must be one of eic|methodology|domain|perspective')
      }
      if (!state.panel.seats.some(seat => seat.seat_id === card.seat)) {
        throw new ReviewError('invalid_state', 'configuration card seat "' + card.seat + '" is not in this ' + state.mode + ' panel')
      }
      if (typeof card.identity !== 'string' || typeof card.expertise !== 'string' || typeof card.focus !== 'string') {
        throw new ReviewError('invalid_state', 'each configuration card needs identity, expertise, and focus strings')
      }
    }
    const timestamp = nowIso()
    const next: ReviewState = {
      ...state,
      status: 'awaiting_panel_confirmation',
      field_analysis: { ...analysis, analyst_run_at: isIsoTimestamp(analysis.analyst_run_at) ? analysis.analyst_run_at : timestamp },
    }
    return this.save(next, timestamp)
  }

  /**
   * Record the user's first human checkpoint on the configuration cards.
   * @param reviewId - review id.
   * @param cards - optional user-adjusted cards replacing the analyst's.
   * @returns the updated record.
   */
  async confirmPanel(reviewId: string, cards?: ConfigurationCard[]): Promise<ReviewState> {
    const state = await this.read(reviewId)
    await this.verifyPaper(state)
    if (state.status !== 'awaiting_panel_confirmation' && state.status !== 'panel_configured') {
      throw new ReviewError('state_conflict', 'the panel can only be confirmed from status panel_configured|awaiting_panel_confirmation, not ' + state.status)
    }
    const timestamp = nowIso()
    const fieldAnalysis: FieldAnalysis | null = state.field_analysis === null
      ? null
      : { ...state.field_analysis, configuration_cards: cards ?? state.field_analysis.configuration_cards }
    const next: ReviewState = {
      ...state,
      status: 'in_review',
      field_analysis: fieldAnalysis,
      checkpoints: { ...state.checkpoints, panel_confirmed_at: timestamp },
      panel: {
        seats: state.panel.seats.map(seat => seat.status === 'pending'
          ? { ...seat, status: 'dispatched' as SeatStatus, dispatched_at: timestamp }
          : seat),
      },
    }
    return this.save(next, timestamp)
  }

  /**
   * Commit one seat report.
   * @param reviewId - review id.
   * @param seatId - seat the report belongs to.
   * @param report - validated report body.
   * @returns the updated record plus the committed report.
   */
  async submit(reviewId: string, seatId: string, report: unknown): Promise<{ state: ReviewState; report: SeatReport }> {
    if (!isSeatId(seatId)) {
      throw new ReviewError('invalid_seat_id', 'unknown seat id "' + seatId + '": expected one of ' + SEAT_IDS.join('|'))
    }
    const state = await this.read(reviewId)
    await this.verifyPaper(state)
    if (state.checkpoints.panel_confirmed_at === null) {
      throw new ReviewError('panel_not_confirmed', 'the reviewer configuration cards have not been confirmed by the user yet '
        + '(human checkpoint 1, docs/PORT_SPEC.md section 2.2); no seat report may be committed before it')
    }
    const seat = this.seatOf(state, seatId)
    if (seat.status === 'submitted') {
      throw new ReviewError('duplicate_submission', 'seat "' + seatId + '" already committed its report at '
        + String(seat.submitted_at) + '; seat reports are immutable')
    }
    const body = validateSeatReportBody(report, seatId, seat.role_marker)
    const timestamp = nowIso()
    const committed: SeatReport = {
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
    }
    await writeJsonAtomic(this.seatPathOf(reviewId, seatId), committed)
    await writeTextAtomic(
      join(this.directoryOf(reviewId), 'seats', seatId + '.md'),
      renderSeatMarkdown(committed, SEAT_DEFINITIONS[seatId].roleName),
    )
    const allSubmitted = state.panel.seats.every(item => item.seat_id === seatId || item.status === 'submitted')
    const next: ReviewState = {
      ...state,
      status: allSubmitted ? 'all_submitted' : 'in_review',
      panel: {
        seats: state.panel.seats.map(item => item.seat_id === seatId
          ? { ...item, status: 'submitted' as SeatStatus, submitted_at: timestamp, report: committed }
          : item),
      },
    }
    const saved = await this.save(next, timestamp)
    return { state: saved, report: committed }
  }

  /**
   * Build the status summary for one review.
   * @param reviewId - review id.
   * @returns summary including the resolved review directory.
   */
  async status(reviewId: string): Promise<ReviewStatusSummary> {
    const state = await this.read(reviewId)
    await this.verifyPaper(state)
    const seats = state.panel.seats
    const submitted = seats.filter(seat => seat.status === 'submitted').map(seat => seat.seat_id)
    const missing = seats.filter(seat => seat.status !== 'submitted').map(seat => seat.seat_id)
    return {
      review_id: state.review_id,
      status: state.status,
      mode: state.mode,
      paper_path: state.paper.path,
      paper_sha256: state.paper.sha256,
      seat_status: seats.map(seat => {
        const verdict = seat.report === null ? null : seat.report.verdict
        return { seat_id: seat.seat_id, role: seat.role_marker, status: seat.status, verdict }
      }),
      required_seats: seats.map(seat => seat.seat_id),
      submitted_seats: submitted,
      missing_seats: missing,
      decision: state.synthesis.decision,
      advisory_checks: state.advisory_checks,
      pending_checkpoint: pendingCheckpointOf(state),
      review_dir: this.directoryOf(reviewId),
      warnings: state.warnings,
    }
  }

  /**
   * Run the editorial synthesis pass over the committed cards and write the
   * decision letter plus revision roadmap.
   * @param reviewId - review id.
   * @param adjudications - explicit DA CRITICAL adjudications, if already known.
   * @returns the updated record and the two written paths.
   */
  async synthesize(
    reviewId: string,
    adjudications?: readonly DevilsAdvocateAdjudication[],
  ): Promise<SynthesisOutcome> {
    const state = await this.read(reviewId)
    await this.verifyPaper(state)
    const missing = state.panel.seats.filter(seat => seat.status !== 'submitted')
    if (missing.length > 0) {
      throw new ReviewError('seats_incomplete', 'synthesis requires every panel seat to be submitted; still open: '
        + missing.map(seat => seat.seat_id).join(', '))
    }
    const timestamp = nowIso()
    const cards = state.panel.seats.map(seat => seat.report)
    const committed: SeatReport[] = []
    for (const card of cards) {
      if (card !== null) committed.push(card)
    }
    const decision = decideFromVerdicts(committed.map(card => card.verdict))
    const adjudicated = normalizeAdjudications(
      adjudications ?? state.synthesis.da_critical_adjudications,
      daCriticalFindingIds(committed),
    )
    const directory = this.directoryOf(reviewId)
    const letterPath = join(directory, state.synthesis.decision_letter_path)
    const roadmapPath = join(directory, state.synthesis.revision_roadmap_path)
    await writeTextAtomic(letterPath, renderDecisionLetter(state, committed, decision, adjudicated, timestamp))
    await writeTextAtomic(roadmapPath, renderRevisionRoadmap(state, committed, timestamp))
    const next: ReviewState = {
      ...state,
      status: 'awaiting_synthesis_approval',
      synthesis: {
        ...state.synthesis,
        requested_at: state.synthesis.requested_at ?? timestamp,
        completed_at: timestamp,
        decision,
        da_critical_adjudications: adjudicated,
      },
    }
    const saved = await this.save(next, timestamp)
    return { state: saved, decisionLetterPath: letterPath, roadmapPath }
  }

  /**
   * Record the human approval that closes the review.
   * @param reviewId - review id.
   * @returns the updated record.
   */
  async approveReport(reviewId: string): Promise<ReviewState> {
    const state = await this.read(reviewId)
    await this.verifyPaper(state)
    if (state.status !== 'awaiting_synthesis_approval') {
      throw new ReviewError('approval_required', 'the report can only be approved after synthesis wrote the decision letter '
        + '(status awaiting_synthesis_approval), not ' + state.status)
    }
    const unresolved = state.synthesis.da_critical_adjudications.filter(item => item.outcome === 'unresolved')
    if (unresolved.length > 0) {
      throw new ReviewError('da_adjudication_required', 'every Devil Advocate CRITICAL finding must be adjudicated visibly '
        + 'before approval; unresolved: ' + unresolved.map(item => item.finding_id).join(', '))
    }
    const timestamp = nowIso()
    const next: ReviewState = {
      ...state,
      status: 'report_ready',
      checkpoints: { ...state.checkpoints, report_approved_at: timestamp },
    }
    return this.save(next, timestamp)
  }
}
