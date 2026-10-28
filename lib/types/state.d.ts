/**
 * Durable review state for the dsh-academic-skills plugin.
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
 * @module dsh-academic-skills/state
 */
/** Panel seats fixed by the Phase 1 port (docs/PORT_SPEC.md §2.1). */
export declare const SEAT_IDS: readonly ["eic", "methodology", "domain", "perspective", "da"];
/** One Phase 1 review seat. */
export type SeatId = (typeof SEAT_IDS)[number];
/** Finding severities accepted from a seat report. */
export declare const SEVERITIES: readonly ["critical", "major", "minor", "comment"];
/** One finding severity. */
export type Severity = (typeof SEVERITIES)[number];
/** Per-seat verdicts accepted from a seat report. */
export declare const VERDICTS: readonly ["accept", "minor_revision", "major_revision", "reject"];
/** One per-seat verdict. */
export type Verdict = (typeof VERDICTS)[number];
/** Operational modes implemented in Phase 1. */
export declare const MODES: readonly ["full", "quick", "methodology-focus"];
/** One Phase 1 review mode. */
export type ReviewMode = (typeof MODES)[number];
/** Upstream modes that exist but are not ported yet (refused, never faked). */
export declare const UNIMPLEMENTED_MODES: readonly ["re-review", "guided", "calibration"];
/** Review lifecycle statuses. */
export declare const REVIEW_STATUSES: readonly ["created", "panel_configured", "awaiting_panel_confirmation", "in_review", "all_submitted", "awaiting_synthesis_approval", "report_ready", "abandoned"];
/** One review lifecycle status. */
export type ReviewStatus = (typeof REVIEW_STATUSES)[number];
/** Seat lifecycle statuses. */
export declare const SEAT_STATUSES: readonly ["pending", "dispatched", "submitted", "failed"];
/** One seat lifecycle status. */
export type SeatStatus = (typeof SEAT_STATUSES)[number];
/** Advisory checker outcomes; upstream defines "not run" as a valid outcome. */
export declare const ADVISORY_OUTCOMES: readonly ["not_run", "passed", "failed", "skipped"];
/** One advisory checker outcome. */
export type AdvisoryOutcome = (typeof ADVISORY_OUTCOMES)[number];
/** Accepted manuscript extensions; PDF/DOCX are rejected, never parsed. */
export declare const ACCEPTED_PAPER_EXTENSIONS: readonly [".md", ".tex", ".txt"];
/** Attribution rendered into every generated report (CC BY-NC 4.0 BY term). */
export declare const ATTRIBUTION_LINE: string;
/** Fixed per-seat protocol facts shared by state, tools, and the prompt pack. */
export interface SeatDefinition {
    /** Stable seat id used by every tool and state file. */
    readonly seatId: SeatId;
    /** Role marker the seat writes into its report (EIC / R1 / R2 / R3 / DA). */
    readonly roleMarker: string;
    /** Human role name from the upstream panel. */
    readonly roleName: string;
    /** Vendored upstream agent file, relative to the plugin's vendor directory. */
    readonly agentFile: string;
    /** Configuration-card index for the seat; null for the fixed Devil's Advocate. */
    readonly configurationCard: number | null;
}
/** Canonical seat table (upstream academic-paper-reviewer/agents/*). */
export declare const SEAT_DEFINITIONS: Readonly<Record<SeatId, SeatDefinition>>;
/** Field-analysis pre-pass agent file (Phase 0). */
export declare const FIELD_ANALYST_AGENT_FILE = "academic-paper-reviewer/agents/field_analyst_agent.md";
/** Editorial synthesis agent file (Phase 2). */
export declare const EDITORIAL_SYNTHESIZER_AGENT_FILE = "academic-paper-reviewer/agents/editorial_synthesizer_agent.md";
/** Seats a mode requires before the panel counts as complete. */
export declare const MODE_SEATS: Readonly<Record<ReviewMode, readonly SeatId[]>>;
/** One evidence quote pinned to a manuscript location. */
export interface ReviewEvidence {
    /** Verbatim manuscript text the finding rests on. */
    readonly quote: string;
    /** Section/line locator inside the manuscript. */
    readonly location: string;
}
/** One finding emitted by a seat. */
export interface ReviewFinding {
    /** Seat-local finding id, e.g. eic-F1. */
    readonly id: string;
    /** Closed severity enum. */
    readonly severity: Severity;
    /** Short finding title. */
    readonly title: string;
    /** Full finding text. */
    readonly detail: string;
    /** At least one quote + location; a claim without evidence is refused. */
    readonly evidence: readonly ReviewEvidence[];
}
/** Provenance recorded per seat (honest role separation, never "independence"). */
export interface SeatProvenance {
    /** Model or route that produced the card. */
    readonly model?: string;
    /** Whether any peer card was visible to this seat; must be false in Phase 1. */
    readonly peerOutputVisible?: boolean;
    /** Whether the seat ran in a fresh context. */
    readonly contextFresh?: boolean;
    /** Human who operated the run, when known. */
    readonly humanOperator?: string;
}
/** One committed seat report (the shape of seats/<seat_id>.json). */
export interface SeatReport {
    /** Schema version of the report envelope. */
    readonly schema_version: '1';
    /** Owning review id. */
    readonly review_id: string;
    /** Seat the report belongs to. */
    readonly seat_id: SeatId;
    /** Role marker copied from SEAT_DEFINITIONS. */
    readonly role: string;
    /** Creation timestamp supplied by the submitter (ISO-8601 with offset). */
    readonly created_at: string;
    /** Commit timestamp assigned by the plugin. */
    readonly submitted_at: string;
    /** Per-seat verdict. */
    readonly verdict: Verdict;
    /** Reviewer confidence in [0, 1]. */
    readonly confidence: number;
    /** Prose summary of the card. */
    readonly summary?: string;
    /** Findings with evidence. */
    readonly findings: readonly ReviewFinding[];
    /** Provenance of the run that produced the card. */
    readonly provenance?: SeatProvenance;
}
/** One panel seat in the durable review record. */
export interface PanelSeat {
    /** Seat id. */
    readonly seat_id: SeatId;
    /** Role marker. */
    readonly role_marker: string;
    /** Vendored agent file path, relative to the plugin vendor directory. */
    readonly agent_file: string;
    /** Seat lifecycle status. */
    status: SeatStatus;
    /** Dispatch timestamp, or null before dispatch. */
    dispatched_at: string | null;
    /** Commit timestamp, or null before submission. */
    submitted_at: string | null;
    /** Configuration-card index, or null for the Devil's Advocate. */
    readonly configuration_card: number | null;
    /** Committed report, or null while the seat is open. */
    report: SeatReport | null;
}
/** One Reviewer Configuration Card produced by the field analyst. */
export interface ConfigurationCard {
    seat: SeatId;
    identity: string;
    expertise: string;
    focus: string;
}
/** Phase 0 field analysis output. */
export interface FieldAnalysis {
    /** When the analyst pass ran. */
    analyst_run_at: string;
    /** Primary discipline. */
    primary_discipline: string;
    /** Secondary disciplines. */
    secondary_disciplines: string[];
    /** Research paradigm. */
    research_paradigm: string;
    /** Methodology type. */
    methodology_type: string;
    /** Target journal tier. */
    target_journal_tier: string;
    /** Paper maturity. */
    paper_maturity: string;
    /** The four Reviewer Configuration Cards (the Devil's Advocate has none). */
    configuration_cards: ConfigurationCard[];
}
/** One visible adjudication of a Devil's Advocate CRITICAL finding. */
export interface DevilsAdvocateAdjudication {
    /** Finding id being adjudicated. */
    finding_id: string;
    /** Adjudication outcome. */
    outcome: 'validated' | 'rejected' | 'unresolved';
    /** Reasoning shown in the decision letter. */
    rationale: string;
}
/** Editorial synthesis slot of the review record. */
export interface SynthesisRecord {
    /** When the synthesizer pass was requested. */
    requested_at: string | null;
    /** When the decision letter and roadmap were written. */
    completed_at: string | null;
    /** Advisory decision derived from the committed cards. */
    decision: Verdict | null;
    /** Decision letter path, relative to the review directory. */
    decision_letter_path: string;
    /** Revision roadmap path, relative to the review directory. */
    revision_roadmap_path: string;
    /** DA CRITICAL adjudications carried into the letter. */
    da_critical_adjudications: DevilsAdvocateAdjudication[];
}
/** Human checkpoints recorded by the plugin. */
export interface CheckpointRecord {
    /** Set when the user confirmed or edited the configuration cards. */
    panel_confirmed_at: string | null;
    /** Set when the user approved the final report. */
    report_approved_at: string | null;
}
/** Paper pinning block of the review record. */
export interface PaperRecord {
    /** Absolute manuscript path. */
    path: string;
    /** SHA-256 of the manuscript bytes at create time. */
    sha256: string;
    /** Size in bytes. */
    bytes: number;
    /** Accepted format without the dot. */
    format: string;
}
/** The durable review record stored in state.json. */
export interface ReviewState {
    /** Schema version of the record. */
    readonly schema_version: '1';
    /** Review id, also the review directory name. */
    readonly review_id: string;
    /** Creation timestamp. */
    readonly created_at: string;
    /** Last mutation timestamp. */
    updated_at: string;
    /** Phase 1 mode. */
    readonly mode: ReviewMode;
    /** Pinned manuscript. */
    readonly paper: PaperRecord;
    /** Vendored upstream skill version. */
    readonly upstream_skill_version: string;
    /** Vendored upstream commit. */
    readonly upstream_commit: string;
    /** Lifecycle status. */
    status: ReviewStatus;
    /** Phase 0 output, null until the analyst pass is attached. */
    field_analysis: FieldAnalysis | null;
    /** Panel seats. */
    panel: {
        seats: PanelSeat[];
    };
    /** Editorial synthesis slot. */
    synthesis: SynthesisRecord;
    /** Human checkpoints. */
    checkpoints: CheckpointRecord;
    /** Advisory checker outcomes. */
    advisory_checks: Record<string, AdvisoryOutcome>;
    /** Non-fatal warnings raised during the run (e.g. oversized manuscript). */
    warnings: string[];
}
/**
 * Workspace root behind one host agent: the configured override when present,
 * else the agent's session cwd, else the process cwd.
 *
 * Slash commands resolve review state through this helper so a review opened
 * from `/ars-review` lands in the exact directory `academic_review_*` tools
 * and the read-only panel routes read.
 *
 * @param agent - the host agent, or any object exposing session.header.cwd.
 * @param override - fixed workspace root from the plugin config.
 * @returns absolute workspace path.
 */
export declare function workspaceOfAgent(agent: unknown, override?: string): string;
/** Stable error codes surfaced to the model instead of raw stack traces. */
export type ReviewErrorCode = 'review_not_found' | 'invalid_state' | 'invalid_mode' | 'invalid_seat_id' | 'invalid_report' | 'unsupported_format' | 'paper_unreadable' | 'paper_changed' | 'duplicate_submission' | 'panel_not_confirmed' | 'seats_incomplete' | 'da_adjudication_required' | 'state_conflict' | 'approval_required';
/** Error carrying a machine-readable review failure code. */
export declare class ReviewError extends Error {
    /** Failure code the tool layer renders verbatim. */
    readonly code: ReviewErrorCode;
    constructor(code: ReviewErrorCode, message: string);
}
/** Store configuration resolved from the plugin config. */
export interface ReviewStoreConfig {
    /** Workspace root the review directory lives under. */
    readonly workspace: string;
    /** Review-state directory name, default .academic-review. */
    readonly stateDir?: string;
    /** Oversize warning threshold in bytes, default 1 MiB. */
    readonly maxPaperBytes?: number;
    /** Vendored upstream skill version recorded in each review. */
    readonly upstreamSkillVersion?: string;
    /** Vendored upstream commit recorded in each review. */
    readonly upstreamCommit?: string;
}
/** Input accepted by ReviewStore.create. */
export interface CreateReviewInput {
    /** Manuscript path: .md, .tex, or .txt. */
    readonly paperPath: string;
    /** Phase 1 mode, default full. */
    readonly mode?: string;
}
/** Summary shape returned by academic_review_status. */
export interface ReviewStatusSummary {
    review_id: string;
    status: ReviewStatus;
    mode: ReviewMode;
    paper_path: string;
    paper_sha256: string;
    seat_status: {
        seat_id: SeatId;
        role: string;
        status: SeatStatus;
        verdict: Verdict | null;
    }[];
    required_seats: SeatId[];
    submitted_seats: SeatId[];
    missing_seats: SeatId[];
    decision: Verdict | null;
    advisory_checks: Record<string, AdvisoryOutcome>;
    pending_checkpoint: string | null;
    review_dir: string;
    warnings: string[];
}
/** Result of a synthesis pass. */
export interface SynthesisOutcome {
    state: ReviewState;
    decisionLetterPath: string;
    roadmapPath: string;
}
/** Current time as ISO-8601 with the local UTC offset (never a bare Z). */
export declare function nowIso(date?: Date): string;
/** Whether a string is an ISO-8601 timestamp with an explicit offset. */
export declare function isIsoTimestamp(value: unknown): value is string;
/** SHA-256 hex digest of a buffer. */
export declare function sha256Of(buffer: Uint8Array): string;
/** Whether a value is a Phase 1 seat id. */
export declare function isSeatId(value: unknown): value is SeatId;
/** Whether a value is an implemented Phase 1 mode. */
export declare function isReviewMode(value: unknown): value is ReviewMode;
/**
 * Resolve one review root directory.
 * @param config - store configuration.
 * @returns absolute review-root path.
 */
export declare function reviewRootOf(config: ReviewStoreConfig): string;
/**
 * Resolve one review directory.
 * @param config - store configuration.
 * @param reviewId - review id.
 * @returns absolute review directory path.
 */
export declare function reviewDirOf(config: ReviewStoreConfig, reviewId: string): string;
/**
 * Reject a manuscript path whose extension Phase 1 cannot read.
 * @param paperPath - caller-supplied manuscript path.
 * @returns the normalized lowercase extension without the dot.
 */
export declare function requireSupportedFormat(paperPath: string): string;
/**
 * Write text through a temp file plus same-directory rename, falling back to an
 * in-place write when a transient Windows lock keeps the target open.
 * @param file - target path.
 * @param text - exact file content.
 */
export declare function writeTextAtomic(file: string, text: string): Promise<void>;
/**
 * Write a value as JSON through an atomic replace.
 * @param file - target path.
 * @param value - losslessly serializable value.
 */
export declare function writeJsonAtomic(file: string, value: unknown): Promise<void>;
/** Validated report content without commit metadata. */
export type SeatReportBody = Omit<SeatReport, 'schema_version' | 'review_id' | 'seat_id' | 'role' | 'submitted_at'>;
/**
 * Validate a submitter-supplied seat report body and normalize it.
 * @param value - raw report argument from the submit tool.
 * @param seatId - seat the report is offered for.
 * @param role - expected role marker.
 * @returns the validated report content without commit metadata.
 */
export declare function validateSeatReportBody(value: unknown, seatId: SeatId, role: string): SeatReportBody;
/**
 * Validate a persisted review record read back from disk.
 * @param value - parsed JSON.
 * @param reviewId - directory-derived review id.
 * @returns the validated record.
 */
export declare function validateReviewState(value: unknown, reviewId: string): ReviewState;
/**
 * Render one committed seat report as Markdown (the seats/<seat>.md copy).
 * @param report - committed report.
 * @param roleName - human role name for the heading.
 * @returns Markdown document.
 */
export declare function renderSeatMarkdown(report: SeatReport, roleName: string): string;
/**
 * Aggregate per-seat verdicts into one advisory decision.
 * The modal verdict wins; a tie resolves toward the more severe verdict.
 * @param verdicts - committed per-seat verdicts.
 * @returns the advisory decision, or null with no verdicts.
 */
export declare function decideFromVerdicts(verdicts: readonly Verdict[]): Verdict | null;
/**
 * Every Devil's Advocate CRITICAL finding id across the committed cards.
 * @param cards - committed cards.
 * @returns finding ids in seat/finding order.
 */
export declare function daCriticalFindingIds(cards: readonly SeatReport[]): string[];
/**
 * The checkpoint a caller is waiting on, or null.
 * @param state - review record.
 * @returns checkpoint name.
 */
export declare function pendingCheckpointOf(state: ReviewState): string | null;
/** A review-state store bound to one workspace. */
export declare class ReviewStore {
    /** Resolved configuration. */
    readonly config: ReviewStoreConfig;
    /** Resolved review root directory. */
    readonly root: string;
    /** Oversize warning threshold in bytes. */
    readonly maxPaperBytes: number;
    constructor(config: ReviewStoreConfig);
    /**
     * Absolute directory of one review.
     * @param reviewId - review id.
     * @returns absolute path.
     */
    directoryOf(reviewId: string): string;
    /**
     * Absolute state.json path of one review.
     * @param reviewId - review id.
     * @returns absolute path.
     */
    statePathOf(reviewId: string): string;
    /**
     * Absolute seat-report path of one review.
     * @param reviewId - review id.
     * @param seatId - seat id.
     * @returns absolute path.
     */
    seatPathOf(reviewId: string, seatId: SeatId): string;
    /**
     * Create a review for one manuscript.
     * @param input - manuscript path plus optional mode.
     * @returns the freshly written record.
     */
    create(input: CreateReviewInput): Promise<ReviewState>;
    /**
     * Read one review record.
     * @param reviewId - review id.
     * @returns validated record.
     */
    read(reviewId: string): Promise<ReviewState>;
    /**
     * List every readable review under this store's root, newest first.
     * @returns review ids paired with their last mutation timestamp.
     */
    list(): Promise<{
        review_id: string;
        updated_at: string;
    }[]>;
    /**
     * Recompute the manuscript digest and fail when the bytes changed.
     * @param state - record whose paper block is pinned.
     * @returns the verified digest.
     */
    verifyPaper(state: ReviewState): Promise<string>;
    /** Persist a mutated record with a refreshed updated_at. */
    private save;
    /** Locate one seat inside a record. */
    private seatOf;
    /**
     * Attach the Phase 0 field analysis and open the panel-confirmation checkpoint.
     * @param reviewId - review id.
     * @param analysis - analyst output, including the four configuration cards.
     * @returns the updated record.
     */
    attachFieldAnalysis(reviewId: string, analysis: FieldAnalysis): Promise<ReviewState>;
    /**
     * Record the user's first human checkpoint on the configuration cards.
     * @param reviewId - review id.
     * @param cards - optional user-adjusted cards replacing the analyst's.
     * @returns the updated record.
     */
    confirmPanel(reviewId: string, cards?: ConfigurationCard[]): Promise<ReviewState>;
    /**
     * Commit one seat report.
     * @param reviewId - review id.
     * @param seatId - seat the report belongs to.
     * @param report - validated report body.
     * @returns the updated record plus the committed report.
     */
    submit(reviewId: string, seatId: string, report: unknown): Promise<{
        state: ReviewState;
        report: SeatReport;
    }>;
    /**
     * Build the status summary for one review.
     * @param reviewId - review id.
     * @returns summary including the resolved review directory.
     */
    status(reviewId: string): Promise<ReviewStatusSummary>;
    /**
     * Run the editorial synthesis pass over the committed cards and write the
     * decision letter plus revision roadmap.
     * @param reviewId - review id.
     * @param adjudications - explicit DA CRITICAL adjudications, if already known.
     * @returns the updated record and the two written paths.
     */
    synthesize(reviewId: string, adjudications?: readonly DevilsAdvocateAdjudication[]): Promise<SynthesisOutcome>;
    /**
     * Record the human approval that closes the review.
     * @param reviewId - review id.
     * @returns the updated record.
     */
    approveReport(reviewId: string): Promise<ReviewState>;
}
