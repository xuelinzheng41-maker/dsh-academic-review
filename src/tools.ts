/**
 * Model-facing review tools for the dsh-academic-skills plugin.
 *
 * Five tools, all prefixed academic_review_, mirroring the tool API fixed in
 * docs/PORT_SPEC.md section 3:
 *
 * - academic_review_create  - pin a manuscript (.md/.tex/.txt) and open a review
 * - academic_review_status  - report status, per-seat state, and pending checkpoint
 * - academic_review_confirm - attach the field analysis and record human
 *                             checkpoint 1 (the only path out of 'created')
 * - academic_review_submit  - commit one seat report (immutable once committed)
 * - academic_review_report  - synthesize the decision letter and roadmap, then
 *                             require an explicit human approval flag
 *
 * The tool layer only validates and presents; every state transition, schema
 * check, and atomic write lives in ./state.ts so tests exercise the same code
 * the model does.
 *
 * @module dsh-academic-skills/tools
 */

import { resolve } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { ToolRunContext } from '@deepseek-ai/dsh-tools'
import {
  ATTRIBUTION_LINE,
  MODES,
  ReviewError,
  ReviewStore,
  SEAT_IDS,
  SEAT_DEFINITIONS,
  nowIso,
  type ConfigurationCard,
  type DevilsAdvocateAdjudication,
  type FieldAnalysis,
  type ReviewStatusSummary,
  type SeatId,
  type Verdict,
} from './state.ts'

/** Resolved tool configuration. */
export interface AcademicReviewToolsConfig {
  /** Review-state directory name under the workspace (default .academic-review). */
  readonly stateDir: string
  /** Optional fixed workspace root; otherwise the calling session cwd is used. */
  readonly workspaceRoot?: string
  /** Oversize warning threshold in bytes. */
  readonly maxPaperBytes?: number
  /** Vendored upstream skill version recorded per review. */
  readonly upstreamSkillVersion?: string
  /** Vendored upstream commit recorded per review. */
  readonly upstreamCommit?: string
}

/** Session workspace used for review state, or the process cwd as a fallback. */
function workspaceOf(exec: ToolRunContext, config: AcademicReviewToolsConfig): string {
  const configured = config.workspaceRoot
  if (configured !== undefined && configured.trim() !== '') return resolve(configured)
  const agent = exec.agent as unknown as { session?: { header?: { cwd?: unknown } } } | undefined
  const cwd = agent?.session?.header?.cwd
  if (typeof cwd === 'string' && cwd !== '') return resolve(cwd)
  return process.cwd()
}

/** Build a store for the calling workspace. */
function storeFor(exec: ToolRunContext, config: AcademicReviewToolsConfig): ReviewStore {
  return new ReviewStore({
    workspace: workspaceOf(exec, config),
    stateDir: config.stateDir,
    ...(config.maxPaperBytes === undefined ? {} : { maxPaperBytes: config.maxPaperBytes }),
    ...(config.upstreamSkillVersion === undefined ? {} : { upstreamSkillVersion: config.upstreamSkillVersion }),
    ...(config.upstreamCommit === undefined ? {} : { upstreamCommit: config.upstreamCommit }),
  })
}

/**
 * Render a review error as a single model-facing line carrying its code, so
 * the model can branch on the failure instead of guessing from prose.
 * @param error - thrown value.
 * @returns the message to surface.
 */
function describeError(error: unknown): string {
  if (error instanceof ReviewError) return error.code + ': ' + error.message
  if (error instanceof Error) return error.message
  return String(error)
}

/** Require a non-empty string argument, naming the field when it is missing. */
function requireText(value: string | undefined, field: string): string {
  if (value === undefined || value.trim() === '') {
    throw new ReviewError('invalid_state', 'action=attach requires a non-empty ' + field)
  }
  return value.trim()
}

/** One text content block. */
function text(value: string): { type: 'text'; text: string }[] {
  return [{ type: 'text', text: value }]
}

/** Wire shape of a seat row in tool output. */
const SEAT_ROW_SCHEMA = {
  type: 'object' as const,
  additionalProperties: false,
  properties: {
    seat_id: { type: 'string' as const, required: true as const },
    role: { type: 'string' as const, required: true as const },
    status: { type: 'string' as const, required: true as const },
    verdict: { type: 'string' as const },
  },
}

/** Wire shape of one adjudication row in tool output. */
const ADJUDICATION_ROW_SCHEMA = {
  type: 'object' as const,
  additionalProperties: false,
  properties: {
    finding_id: { type: 'string' as const, required: true as const },
    outcome: { type: 'string' as const, required: true as const },
    rationale: { type: 'string' as const, required: true as const },
  },
}

/** Render the per-seat table used by create/status/submit results. */
function seatLines(summary: { seat_id: string; role: string; status: string; verdict: string | null }[]): string {
  return summary.map(row => '  - ' + row.seat_id + ' (' + row.role + '): ' + row.status
    + (row.verdict === null ? '' : ', verdict ' + row.verdict)).join('\n')
}

/**
 * Register the five academic_review_* tools into the shared tools registry.
 * @param ctx - plugin context (injects tools).
 * @param config - resolved tool configuration.
 */
export function registerAcademicReviewTools(ctx: Context, config: AcademicReviewToolsConfig): void {
  ctx.tools.register(defineTool({
    name: 'academic_review_create',
    description:
      'Open a peer-review run for one manuscript (.md, .tex, or .txt only; PDF is rejected, not parsed). '
      + 'Pins the manuscript SHA-256, creates the review state directory, and lays out the panel seats for the '
      + 'chosen mode (full = 5 seats, quick = EIC only, methodology-focus = EIC + methodology). '
      + 'The manuscript is read-only for the whole run.',
    parameters: {
      paper_path: { type: 'string', required: true, description: 'Absolute or relative path to the manuscript (.md/.tex/.txt).' },
      mode: {
        type: 'string',
        enum: [...MODES],
        description: 'Review mode. Defaults to full. re-review, guided, and calibration are not implemented in Phase 1.',
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          review_id: { type: 'string', required: true },
          status: { type: 'string', required: true },
          mode: { type: 'string', required: true },
          paper_path: { type: 'string', required: true },
          paper_sha256: { type: 'string', required: true },
          paper_bytes: { type: 'integer', required: true },
          review_dir: { type: 'string', required: true },
          seats: { type: 'array', required: true, items: SEAT_ROW_SCHEMA },
          next_step: { type: 'string', required: true },
          warnings: { type: 'array', required: true, items: { type: 'string' } },
        },
      },
      render: (_args, value) => text([
        'Review ' + value.review_id + ' created (' + value.mode + ' mode) under ' + value.review_dir + '.',
        'Manuscript: ' + value.paper_path + ' (' + String(value.paper_bytes) + ' bytes, sha256 ' + value.paper_sha256 + ')',
        'Seats:',
        seatLines(value.seats.map(seat => ({
          seat_id: seat.seat_id,
          role: seat.role,
          status: seat.status,
          verdict: seat.verdict === undefined ? null : seat.verdict,
        }))),
        value.warnings.length === 0 ? '' : 'Warnings:\n' + value.warnings.map(item => '  - ' + item).join('\n'),
        'Next: ' + value.next_step,
      ].filter(line => line !== '').join('\n')),
    },
    async execute(args, exec) {
      try {
        const store = storeFor(exec, config)
        const state = await store.create({
          paperPath: args.paper_path,
          ...(args.mode === undefined ? {} : { mode: args.mode }),
        })
        return {
          review_id: state.review_id,
          status: state.status,
          mode: state.mode,
          paper_path: state.paper.path,
          paper_sha256: state.paper.sha256,
          paper_bytes: state.paper.bytes,
          review_dir: store.directoryOf(state.review_id),
          seats: state.panel.seats.map(seat => {
            const row: { seat_id: string; role: string; status: string; verdict?: string } = {
              seat_id: seat.seat_id,
              role: seat.role_marker,
              status: seat.status,
            }
            return row
          }),
          next_step: 'Run the field-analyst subagent over the manuscript and attach its four configuration cards; '
            + 'then stop at the panel-confirmation checkpoint before dispatching any review seat.',
          warnings: state.warnings,
        }
      } catch (error) {
        throw new Error('academic_review_create failed - ' + describeError(error))
      }
    },
  }))

  ctx.tools.register(defineTool({
    name: 'academic_review_status',
    description:
      'Report one review: lifecycle status, per-seat status and verdicts, the advisory decision, advisory checker '
      + 'outcomes, and which human checkpoint is pending. Re-verifies the manuscript SHA-256 on every call.',
    parameters: {
      review_id: { type: 'string', required: true, description: 'Review id returned by academic_review_create.' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          review_id: { type: 'string', required: true },
          status: { type: 'string', required: true },
          mode: { type: 'string', required: true },
          paper_path: { type: 'string', required: true },
          paper_sha256: { type: 'string', required: true },
          seats: { type: 'array', required: true, items: SEAT_ROW_SCHEMA },
          submitted_seats: { type: 'array', required: true, items: { type: 'string' } },
          missing_seats: { type: 'array', required: true, items: { type: 'string' } },
          decision: { type: 'string' },
          pending_checkpoint: { type: 'string' },
          advisory_checks: { type: 'json', required: true },
          review_dir: { type: 'string', required: true },
          warnings: { type: 'array', required: true, items: { type: 'string' } },
        },
      },
      render: (_args, value) => text(renderStatusText(value)),
    },
    async execute(args, exec) {
      try {
        const store = storeFor(exec, config)
        const summary = await store.status(args.review_id)
        const decision = summary.decision === null ? undefined : summary.decision
        const checkpoint = summary.pending_checkpoint === null ? undefined : summary.pending_checkpoint
        return {
          review_id: summary.review_id,
          status: summary.status,
          mode: summary.mode,
          paper_path: summary.paper_path,
          paper_sha256: summary.paper_sha256,
          seats: summary.seat_status.map(row => {
            const wire: { seat_id: string; role: string; status: string; verdict?: string } = {
              seat_id: row.seat_id,
              role: row.role,
              status: row.status,
            }
            if (row.verdict !== null) wire.verdict = row.verdict
            return wire
          }),
          submitted_seats: [...summary.submitted_seats],
          missing_seats: [...summary.missing_seats],
          ...(decision === undefined ? {} : { decision }),
          ...(checkpoint === undefined ? {} : { pending_checkpoint: checkpoint }),
          advisory_checks: { ...summary.advisory_checks },
          review_dir: summary.review_dir,
          warnings: [...summary.warnings],
        }
      } catch (error) {
        throw new Error('academic_review_status failed - ' + describeError(error))
      }
    },
  }))

  ctx.tools.register(defineTool({
    name: 'academic_review_submit',
    description:
      'Commit one seat report into the review. Refused before the user confirms the reviewer configuration cards, '
      + 'refused for an unknown seat id, and refused for a seat that already committed (reports are immutable). '
      + 'Every finding needs at least one evidence quote with a manuscript location.',
    parameters: {
      review_id: { type: 'string', required: true, description: 'Review id.' },
      seat_id: {
        type: 'string',
        required: true,
        enum: [...SEAT_IDS],
        description: 'Seat committing the report: eic, methodology, domain, perspective, or da.',
      },
      report: {
        type: 'object',
        required: true,
        additionalProperties: false,
        description: 'The seat card: verdict, confidence, created_at, summary, findings with evidence, provenance.',
        properties: {
          verdict: {
            type: 'string',
            required: true,
            enum: ['accept', 'minor_revision', 'major_revision', 'reject'],
          },
          confidence: { type: 'number', required: true, description: 'Reviewer confidence between 0 and 1.' },
          created_at: { type: 'string', required: true, description: 'ISO-8601 timestamp with an explicit UTC offset.' },
          summary: { type: 'string', description: 'Prose summary of the card.' },
          findings: {
            type: 'array',
            required: true,
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                id: { type: 'string', required: true },
                severity: { type: 'string', required: true, enum: ['critical', 'major', 'minor', 'comment'] },
                title: { type: 'string', required: true },
                detail: { type: 'string', required: true },
                evidence: {
                  type: 'array',
                  required: true,
                  items: {
                    type: 'object',
                    additionalProperties: false,
                    properties: {
                      quote: { type: 'string', required: true },
                      location: { type: 'string', required: true },
                    },
                  },
                },
              },
            },
          },
          provenance: {
            type: 'object',
            additionalProperties: false,
            description: 'Honest record of the run; peerOutputVisible must be false in Phase 1.',
            properties: {
              model: { type: 'string' },
              peerOutputVisible: { type: 'boolean' },
              contextFresh: { type: 'boolean' },
              humanOperator: { type: 'string' },
            },
          },
        },
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          review_id: { type: 'string', required: true },
          seat_id: { type: 'string', required: true },
          role: { type: 'string', required: true },
          verdict: { type: 'string', required: true },
          status: { type: 'string', required: true },
          submitted_seats: { type: 'array', required: true, items: { type: 'string' } },
          missing_seats: { type: 'array', required: true, items: { type: 'string' } },
          report_path: { type: 'string', required: true },
          next_step: { type: 'string', required: true },
        },
      },
      render: (_args, value) => text([
        'Seat ' + value.seat_id + ' (' + value.role + ') committed verdict ' + value.verdict
          + '; review ' + value.review_id + ' is now ' + value.status + '.',
        'Committed: ' + value.submitted_seats.join(', '),
        value.missing_seats.length === 0
          ? 'All panel seats are in.'
          : 'Still open: ' + value.missing_seats.join(', '),
        'Report file: ' + value.report_path,
        'Next: ' + value.next_step,
      ].join('\n')),
    },
    async execute(args, exec) {
      try {
        const store = storeFor(exec, config)
        const result = await store.submit(args.review_id, args.seat_id, args.report)
        const missing = result.state.panel.seats
          .filter(seat => seat.status !== 'submitted')
          .map(seat => seat.seat_id)
        return {
          review_id: result.state.review_id,
          seat_id: result.report.seat_id,
          role: result.report.role,
          verdict: result.report.verdict,
          status: result.state.status,
          submitted_seats: result.state.panel.seats
            .filter(seat => seat.status === 'submitted')
            .map(seat => seat.seat_id),
          missing_seats: missing,
          report_path: store.seatPathOf(result.state.review_id, result.report.seat_id),
          next_step: missing.length === 0
            ? 'Every seat is committed: call academic_review_report to synthesize the decision letter and '
              + 'revision roadmap (approve=false first), then ask the user to approve the report.'
            : 'Dispatch the remaining seats: ' + missing.join(', ') + '.',
        }
      } catch (error) {
        throw new Error('academic_review_submit failed - ' + describeError(error))
      }
    },
  }))

  ctx.tools.register(defineTool({
    name: 'academic_review_confirm',
    description:
      'Advance a review through human checkpoint 1 (Phase 0). action=attach stores the field-analyst result - '
      + 'primary/secondary discipline, research paradigm, methodology type, target journal tier, paper maturity, '
      + 'and the four reviewer configuration cards - and moves the review created -> awaiting_panel_confirmation. '
      + 'action=confirm records the user explicit approval of those cards (optionally edited) and moves the review '
      + '-> in_review; it is the only way a review becomes submittable. Nothing confirms implicitly: '
      + 'academic_review_submit keeps refusing with panel_not_confirmed until confirm has run.',
    parameters: {
      review_id: { type: 'string', required: true, description: 'Review id returned by academic_review_create.' },
      action: {
        type: 'string',
        required: true,
        enum: ['attach', 'confirm'],
        description: 'attach = store the field analysis (requires the payload below); confirm = record the human checkpoint on the cards.',
      },
      primary_discipline: { type: 'string', description: 'action=attach: primary discipline identified by the field analyst.' },
      secondary_disciplines: {
        type: 'array',
        items: { type: 'string' },
        description: 'action=attach: secondary disciplines; may be empty.',
      },
      research_paradigm: { type: 'string', description: 'action=attach: research paradigm.' },
      methodology_type: { type: 'string', description: 'action=attach: methodology type.' },
      target_journal_tier: { type: 'string', description: 'action=attach: target journal tier.' },
      paper_maturity: { type: 'string', description: 'action=attach: paper maturity assessment.' },
      configuration_cards: {
        type: 'array',
        description:
          'action=attach: one card per peer seat in this panel (four in full mode, fewer in reduced modes); the '
          + "Devil's Advocate seat takes no card. action=confirm: optional user-edited cards to record with the checkpoint.",
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            seat: { type: 'string', required: true, enum: [...SEAT_IDS] },
            identity: { type: 'string', required: true },
            expertise: { type: 'string', required: true },
            focus: { type: 'string', required: true },
          },
        },
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          review_id: { type: 'string', required: true },
          action: { type: 'string', required: true },
          status: { type: 'string', required: true },
          field_analysis_attached: { type: 'boolean', required: true },
          panel_confirmed_at: { type: 'string' },
          seats: { type: 'array', required: true, items: SEAT_ROW_SCHEMA },
          pending_checkpoint: { type: 'string' },
          next_step: { type: 'string', required: true },
        },
      },
      render: (_args, value) => text([
        'academic_review_confirm (' + value.action + ') on review ' + value.review_id + ': now ' + value.status + '.',
        'Field analysis attached: ' + String(value.field_analysis_attached),
        value.panel_confirmed_at === undefined
          ? 'Checkpoint 1 not yet recorded.'
          : 'Checkpoint 1 recorded at ' + value.panel_confirmed_at + '.',
        'Seats:',
        seatLines(value.seats.map(seat => ({
          seat_id: seat.seat_id,
          role: seat.role,
          status: seat.status,
          verdict: seat.verdict === undefined ? null : seat.verdict,
        }))),
        value.pending_checkpoint === undefined ? '' : 'Pending checkpoint: ' + value.pending_checkpoint,
        'Next: ' + value.next_step,
      ].filter(line => line !== '').join('\n')),
    },
    async execute(args, exec) {
      try {
        const store = storeFor(exec, config)
        let cards: ConfigurationCard[] | undefined
        if (args.configuration_cards !== undefined) {
          cards = args.configuration_cards.map(card => ({
            seat: card.seat,
            identity: card.identity,
            expertise: card.expertise,
            focus: card.focus,
          }))
        }
        if (args.action === 'attach') {
          if (cards === undefined || cards.length === 0) {
            throw new ReviewError('invalid_state', 'action=attach requires configuration_cards: one card per peer seat '
              + '(four in full mode, the Devil Advocate seat takes none)')
          }
          const analysis: FieldAnalysis = {
            analyst_run_at: nowIso(),
            primary_discipline: requireText(args.primary_discipline, 'primary_discipline'),
            secondary_disciplines: args.secondary_disciplines === undefined ? [] : [...args.secondary_disciplines],
            research_paradigm: requireText(args.research_paradigm, 'research_paradigm'),
            methodology_type: requireText(args.methodology_type, 'methodology_type'),
            target_journal_tier: requireText(args.target_journal_tier, 'target_journal_tier'),
            paper_maturity: requireText(args.paper_maturity, 'paper_maturity'),
            configuration_cards: cards,
          }
          const state = await store.attachFieldAnalysis(args.review_id, analysis)
          return {
            review_id: state.review_id,
            action: 'attach',
            status: state.status,
            field_analysis_attached: state.field_analysis !== null,
            seats: state.panel.seats.map(seat => {
              const row: { seat_id: string; role: string; status: string } = {
                seat_id: seat.seat_id,
                role: seat.role_marker,
                status: seat.status,
              }
              return row
            }),
            pending_checkpoint: 'panel_confirmation',
            next_step: 'Show the four configuration cards to the user and ask whether to confirm or edit them, '
              + 'then call academic_review_confirm with action=confirm. No seat may commit before that.',
          }
        }
        const state = await store.confirmPanel(args.review_id, cards)
        return {
          review_id: state.review_id,
          action: 'confirm',
          status: state.status,
          field_analysis_attached: state.field_analysis !== null,
          ...(state.checkpoints.panel_confirmed_at === null
            ? {}
            : { panel_confirmed_at: state.checkpoints.panel_confirmed_at }),
          seats: state.panel.seats.map(seat => {
            const row: { seat_id: string; role: string; status: string } = {
              seat_id: seat.seat_id,
              role: seat.role_marker,
              status: seat.status,
            }
            return row
          }),
          next_step: 'Dispatch the panel seats against the vendored agent files and commit each card with '
            + 'academic_review_submit as it lands.',
        }
      } catch (error) {
        throw new Error('academic_review_confirm failed - ' + describeError(error))
      }
    },
  }))

  ctx.tools.register(defineTool({
    name: 'academic_review_report',
    description:
      'Phase 2 entry: synthesize the editorial decision letter and the non-ranking revision roadmap from the five '
      + 'committed seat cards. Without approve=true it only writes the draft letter and roadmap and leaves the review '
      + 'awaiting human approval. approve=true requires the user to have approved the draft AND every '
      + "Devil's Advocate CRITICAL finding to be adjudicated; the plugin never approves its own output.",
    parameters: {
      review_id: { type: 'string', required: true, description: 'Review id.' },
      approve: {
        type: 'boolean',
        description: 'Set only after the user explicitly approved the draft report (human checkpoint 2).',
      },
      da_adjudications: {
        type: 'array',
        description: "Explicit adjudication of each Devil's Advocate CRITICAL finding.",
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            finding_id: { type: 'string', required: true },
            outcome: { type: 'string', required: true, enum: ['validated', 'rejected', 'unresolved'] },
            rationale: { type: 'string', required: true },
          },
        },
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          review_id: { type: 'string', required: true },
          status: { type: 'string', required: true },
          decision: { type: 'string' },
          decision_letter_path: { type: 'string', required: true },
          revision_roadmap_path: { type: 'string', required: true },
          approved: { type: 'boolean', required: true },
          da_critical_adjudications: { type: 'array', required: true, items: ADJUDICATION_ROW_SCHEMA },
          next_step: { type: 'string', required: true },
          attribution: { type: 'string', required: true },
        },
      },
      render: (_args, value) => text([
        'Review ' + value.review_id + ' is ' + value.status + '.',
        'Advisory decision: ' + (value.decision ?? 'undetermined'),
        'Decision letter: ' + value.decision_letter_path,
        'Revision roadmap: ' + value.revision_roadmap_path,
        'Human approval recorded: ' + String(value.approved),
        value.da_critical_adjudications.length === 0
          ? "No Devil's Advocate CRITICAL finding needed adjudication."
          : "Devil's Advocate CRITICAL adjudications:\n" + value.da_critical_adjudications
            .map(row => '  - ' + row.finding_id + ': ' + row.outcome + ' (' + row.rationale + ')')
            .join('\n'),
        'Next: ' + value.next_step,
        value.attribution,
      ].join('\n')),
    },
    async execute(args, exec) {
      try {
        const store = storeFor(exec, config)
        const adjudications: DevilsAdvocateAdjudication[] | undefined = args.da_adjudications === undefined
          ? undefined
          : args.da_adjudications.map(row => ({
            finding_id: row.finding_id,
            outcome: row.outcome as DevilsAdvocateAdjudication['outcome'],
            rationale: row.rationale,
          }))
        const current = await store.status(args.review_id)
        let state = await store.read(args.review_id)
        if (current.status === 'in_review' || current.status === 'all_submitted') {
          const synthesized = await store.synthesize(args.review_id, adjudications)
          state = synthesized.state
        } else if (adjudications !== undefined && current.status === 'awaiting_synthesis_approval') {
          const synthesized = await store.synthesize(args.review_id, adjudications)
          state = synthesized.state
        }
        const approved = args.approve === true
        if (approved) {
          state = await store.approveReport(args.review_id)
        }
        const decision = state.synthesis.decision === null ? undefined : state.synthesis.decision
        return {
          review_id: state.review_id,
          status: state.status,
          ...(decision === undefined ? {} : { decision }),
          decision_letter_path: state.synthesis.decision_letter_path,
          revision_roadmap_path: state.synthesis.revision_roadmap_path,
          approved: state.checkpoints.report_approved_at !== null,
          da_critical_adjudications: state.synthesis.da_critical_adjudications.map(row => ({
            finding_id: row.finding_id,
            outcome: row.outcome,
            rationale: row.rationale,
          })),
          next_step: state.status === 'report_ready'
            ? 'Deliver the decision letter and roadmap to the user; the review is closed.'
            : 'Show the draft decision letter and roadmap to the user and ask whether to approve '
              + '(academic_review_report with approve=true).',
          attribution: ATTRIBUTION_LINE,
        }
      } catch (error) {
        throw new Error('academic_review_report failed - ' + describeError(error))
      }
    },
  }))
}

/** Wire shape of one status tool result, used by the shared renderer. */
interface StatusOutput {
  review_id: string
  status: string
  mode: string
  paper_path: string
  paper_sha256: string
  seats: { seat_id: string; role: string; status: string; verdict?: string }[]
  submitted_seats: string[]
  missing_seats: string[]
  decision?: string
  pending_checkpoint?: string
  advisory_checks: unknown
  review_dir: string
  warnings: string[]
}

/**
 * Render a status result as one model-facing text block.
 * @param value - validated status output.
 * @returns rendered text.
 */
export function renderStatusText(value: StatusOutput): string {
  const checks = renderAdvisoryChecks(value.advisory_checks)
  return [
    'Review ' + value.review_id + ': ' + value.status + ' (' + value.mode + ' mode)',
    'Manuscript: ' + value.paper_path + ' (sha256 ' + value.paper_sha256 + ')',
    'Seats:',
    seatLines(value.seats.map(seat => ({
      seat_id: seat.seat_id,
      role: seat.role,
      status: seat.status,
      verdict: seat.verdict === undefined ? null : seat.verdict,
    }))),
    'Submitted: ' + (value.submitted_seats.length === 0 ? '(none)' : value.submitted_seats.join(', ')),
    'Missing: ' + (value.missing_seats.length === 0 ? '(none)' : value.missing_seats.join(', ')),
    'Advisory decision: ' + (value.decision === undefined ? 'none yet' : value.decision),
    'Pending checkpoint: ' + (value.pending_checkpoint === undefined ? 'none' : value.pending_checkpoint),
    'Advisory checks: ' + (checks === '' ? '(none)' : checks),
    'Review directory: ' + value.review_dir,
    value.warnings.length === 0 ? '' : 'Warnings:\n' + value.warnings.map(item => '  - ' + item).join('\n'),
  ].filter(line => line !== '').join('\n')
}

/** Render the advisory-check map without assuming its concrete shape. */
function renderAdvisoryChecks(value: unknown): string {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return ''
  const record = value as Record<string, unknown>
  return Object.keys(record).map(key => key + '=' + String(record[key])).join(', ')
}

/** Seat metadata exported for the prompt pack (T6) and the GUI panel (T3). */
export const REVIEW_SEAT_METADATA: readonly {
  seat_id: SeatId
  role_marker: string
  role_name: string
  agent_file: string
}[] = SEAT_IDS.map(seatId => ({
  seat_id: seatId,
  role_marker: SEAT_DEFINITIONS[seatId].roleMarker,
  role_name: SEAT_DEFINITIONS[seatId].roleName,
  agent_file: SEAT_DEFINITIONS[seatId].agentFile,
}))

/** Verdict union re-exported for consumers that only import the tool layer. */
export type { Verdict, ReviewStatusSummary }
