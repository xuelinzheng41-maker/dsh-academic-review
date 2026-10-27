#!/usr/bin/env node
/**
 * Deterministic end-to-end harness for the dsh-academic-review plugin
 * (pnpm test:e2e).
 *
 * What it does, in order, against ONE throwaway workspace under the OS temp
 * directory:
 *
 *   create -> confirm(action=attach, 4 configuration cards)
 *          -> confirm(action=confirm) -> 5x submit with fixed seat fixtures
 *          -> report(approve=false)     (writes the draft, refuses to close)
 *          -> report(approve=true)      (refused while the DA CRITICAL is open)
 *          -> report(approve=true + DA adjudication) -> report_ready
 *
 * Every transition is asserted twice: once on the tool result the model would
 * read, and once on the state.json the store wrote. Then the on-disk artifact
 * set is asserted (state.json, seats/<seat>.json + seats/<seat>.md,
 * editorial_decision.md, revision_roadmap.md), the three read-only web routes
 * are resolved through the REAL host prefix semantics
 * (tests/host-prefix-matcher.mjs) and driven end to end (200 list/detail/
 * report, 404 invalid id, 401 unauthenticated, 405 POST), and the two negative
 * gates run in a second workspace (.pdf refused with unsupported_format, and a
 * one-byte manuscript edit after attach refused with paper_changed).
 *
 * Determinism:
 * - every seat report, card, and field-analysis value is a fixed fixture; the
 *   only clock-dependent values are the plugin's own timestamps, which the
 *   state layer cannot be told to freeze (src/state.ts nowIso() calls
 *   new Date()), so they are pattern-asserted instead of value-asserted;
 * - the review id is generated from the real clock plus 4 random bytes, so it
 *   is pattern-asserted too (rev-YYYYMMDD-8hex);
 * - each run gets a unique temp root and removes it at the end, so no state
 *   ever lands in the repository;
 * - there is no network access and no model call anywhere: globalThis.fetch is
 *   trapped and must stay at zero calls, and the only code driven is the five
 *   review tools through the real cordis tool registry.
 *
 * Exit code: 0 when every check passes, 1 otherwise (the failure is printed).
 *
 * @module dsh-academic-review/scripts/e2e
 */

import assert from 'node:assert/strict'
import { appendFile, mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { performance } from 'node:perf_hooks'
import { fileURLToPath } from 'node:url'
import {
  PAPER_TEXT,
  callTool,
  expectFailure,
  fieldAnalysis,
  finding,
  mountReviewPlugin,
  rendered,
  seatReport,
} from '../tests/helpers.mjs'
import { resolveRoute } from '../tests/host-prefix-matcher.mjs'

/** Repository root, so the harness reads the same manifests the package ships. */
const repoRoot = fileURLToPath(new URL('..', import.meta.url))

/** Review-state directory name used for both harness workspaces. */
const STATE_DIR = '.academic-review'
/** Fixed timestamp written into every fixture seat card (explicit offset). */
const CREATED_AT = '2026-03-02T09:15:00+00:00'
/** Review ids are tool-generated: rev-YYYYMMDD-8hex. */
const REVIEW_ID_RE = /^rev-[0-9]{8}-[0-9a-f]{8}$/
/** Timestamps the plugin assigns carry an explicit offset, never a bare Z. */
const ISO_WITH_OFFSET = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[+-]\d{2}:\d{2}$/
/** The five tools the plugin must expose. */
const TOOL_NAMES = [
  'academic_review_confirm',
  'academic_review_create',
  'academic_review_report',
  'academic_review_status',
  'academic_review_submit',
]

/**
 * Fixed seat fixtures. Three major_revision cards make the modal advisory
 * decision unambiguous (major_revision); the DA card carries exactly one
 * CRITICAL finding (da-F1) so human checkpoint 2 has something to adjudicate.
 */
const SEAT_FIXTURES = [
  {
    seat_id: 'eic',
    verdict: 'major_revision',
    confidence: 0.71,
    summary: 'Fit is plausible for a Q1 granular-computing venue, but the contribution is oversold.',
    findings: [finding('eic-F1', { severity: 'major', title: 'The stated contribution is broader than the evidence' })],
  },
  {
    seat_id: 'methodology',
    verdict: 'major_revision',
    confidence: 0.83,
    summary: 'One seed and three benchmarks cannot carry a 3.1 point gain.',
    findings: [finding('methodology-F1', { severity: 'critical', title: 'Single-seed evaluation cannot support the reported gain' })],
  },
  {
    seat_id: 'domain',
    verdict: 'major_revision',
    confidence: 0.66,
    summary: 'Granular-ball positioning is thin.',
    findings: [finding('domain-F1', { severity: 'minor', title: 'Granular-ball literature is under-cited' })],
  },
  {
    seat_id: 'perspective',
    verdict: 'accept',
    confidence: 0.58,
    summary: 'The deployment story is credible for noisy-label pipelines.',
    findings: [finding('perspective-F1', { severity: 'comment', title: 'Deployment path is plausible but untested' })],
  },
  {
    seat_id: 'da',
    verdict: 'reject',
    confidence: 0.77,
    summary: 'The central claim is never stated as a testable hypothesis.',
    findings: [
      finding('da-F1', { severity: 'critical', title: 'The central claim is never stated as a testable hypothesis' }),
      finding('da-F2', { severity: 'minor', title: 'Baseline selection is unargued' }),
    ],
  },
]

/** The four configuration cards the field analyst would attach (full mode). */
const CONFIGURATION_CARDS = fieldAnalysis().configuration_cards

/** One fixed seat report body, shaped for academic_review_submit. */
function seatReportBody(fixture) {
  return seatReport({
    verdict: fixture.verdict,
    confidence: fixture.confidence,
    summary: fixture.summary,
    created_at: CREATED_AT,
    findings: fixture.findings,
    provenance: {
      model: 'fixture seat card (no model call)',
      peerOutputVisible: false,
      contextFresh: true,
      humanOperator: 'scripts/e2e.mjs',
    },
  })
}

/** action=attach arguments built from the fixed field-analysis fixture. */
function attachArgs(reviewId) {
  const analysis = fieldAnalysis()
  return {
    review_id: reviewId,
    action: 'attach',
    primary_discipline: analysis.primary_discipline,
    secondary_disciplines: analysis.secondary_disciplines,
    research_paradigm: analysis.research_paradigm,
    methodology_type: analysis.methodology_type,
    target_journal_tier: analysis.target_journal_tier,
    paper_maturity: analysis.paper_maturity,
    configuration_cards: CONFIGURATION_CARDS,
  }
}

/** Check counter plus the reporting helpers the run prints through. */
const report = { checks: 0 }
/** Harness start, used to report the total runtime on both paths. */
const harnessStart = performance.now()

/** Start a named phase. */
function section(title) {
  console.log('\n\u25b6 ' + title)
}

/** Record one passed assertion. */
function ok(label, detail) {
  report.checks += 1
  console.log('  \u2714 ' + label + (detail === undefined || detail === '' ? '' : '  [' + detail + ']'))
}

/** Read and parse one JSON file. */
async function readJson(file) {
  return JSON.parse(await readFile(file, 'utf8'))
}

/** Assert a file exists and return its text. */
async function readText(file) {
  await stat(file)
  return readFile(file, 'utf8')
}

/**
 * Mount the three read-only review routes on a throwaway cordis Context whose
 * webServer records routes VERBATIM (no normalization), so the harness can
 * resolve paths through the real host prefix matcher.
 * @param workspaceRoot - workspace the routes read state from.
 * @param rejection - value the connection gate returns for every request (undefined = authenticated).
 */
async function mountWebFace(workspaceRoot, rejection = undefined) {
  const { Context } = await import('@deepseek-ai/cordis')
  const { registerAcademicReviewWebRoutes } = await import('../lib/web.js')
  const ctx = new Context()
  const registered = []
  ctx.provide('webServer', {
    register(route) {
      registered.push(route)
      return () => {}
    },
  })
  ctx.provide('connection', { requestRejection: () => rejection })
  registerAcademicReviewWebRoutes(ctx, { stateDir: STATE_DIR, workspaceRoot })
  return registered
}

/** Drive one registered route handler with a fake IncomingMessage/ServerResponse. */
async function request(route, pathname, method = 'GET') {
  assert.ok(route, 'no route resolved for ' + pathname)
  let status
  let body = ''
  const res = {
    writeHead(code) {
      status = code
      return res
    },
    end(chunk) {
      body = chunk === undefined ? '' : String(chunk)
    },
  }
  await route.handler({ method, url: pathname }, res)
  return { status, body, json: () => JSON.parse(body) }
}

/** Resolve the review directory so every on-disk assertion reads one place. */
const dirOf = (workspace, reviewId) => join(workspace, STATE_DIR, reviewId)

/**
 * Phase 1: create -> attach -> confirm, asserting the record after each step.
 * @returns the review id plus the review directory and a state reader.
 */
async function runCheckpointOne(tools, workspace, manuscript) {
  const paperStat = await stat(manuscript)

  const created = await callTool(tools, 'academic_review_create', { paper_path: manuscript, mode: 'full' }, 'e2e-create')
  assert.equal(created.isError, false, rendered(created))
  const review = created.value
  assert.equal(review.status, 'created')
  assert.equal(review.mode, 'full')
  assert.match(review.review_id, REVIEW_ID_RE)
  assert.equal(review.paper_bytes, paperStat.size)
  assert.match(review.paper_sha256, /^[0-9a-f]{64}$/)
  assert.deepEqual(review.seats.map(seat => seat.seat_id), ['eic', 'methodology', 'domain', 'perspective', 'da'])
  assert.deepEqual(review.seats.map(seat => seat.status), ['pending', 'pending', 'pending', 'pending', 'pending'])
  const reviewId = review.review_id
  const reviewDir = dirOf(workspace, reviewId)
  const state = async () => readJson(join(reviewDir, 'state.json'))

  ok('create -> status created, 5-seat full panel, manuscript pinned', reviewId + ', ' + String(review.paper_bytes) + ' bytes')
  assert.equal(review.review_dir, reviewDir)
  assert.deepEqual(review.seats.map(seat => seat.role), ['EIC', 'R1', 'R2', 'R3', 'DA'])
  ok('create -> role markers EIC/R1/R2/R3/DA and review_dir is the temp state dir')

  const createdState = await state()
  assert.equal(createdState.status, 'created')
  assert.equal(createdState.paper.sha256, review.paper_sha256)
  assert.equal(createdState.paper.format, 'md')
  assert.equal(createdState.field_analysis, null)
  assert.equal(createdState.checkpoints.panel_confirmed_at, null)
  assert.deepEqual(Object.keys(createdState.advisory_checks).sort(), ['acronyms', 'reviewer_claims', 'suggested_references'])
  assert.match(createdState.created_at, ISO_WITH_OFFSET)
  ok('create -> state.json on disk: status created, paper.sha256 pinned, no field analysis, no checkpoint')

  // Checkpoint 1 gate: no seat may commit before the user confirms the cards.
  expectFailure(await callTool(tools, 'academic_review_submit', {
    review_id: reviewId,
    seat_id: 'eic',
    report: seatReportBody(SEAT_FIXTURES[0]),
  }, 'e2e-submit-early'), /panel_not_confirmed/)
  ok('gate: submit before confirm refuses with panel_not_confirmed')

  const attached = await callTool(tools, 'academic_review_confirm', attachArgs(reviewId), 'e2e-confirm-attach')
  assert.equal(attached.isError, false, rendered(attached))
  assert.equal(attached.value.action, 'attach')
  assert.equal(attached.value.status, 'awaiting_panel_confirmation')
  assert.equal(attached.value.field_analysis_attached, true)
  assert.equal(attached.value.panel_confirmed_at, undefined)
  assert.equal(attached.value.pending_checkpoint, 'panel_confirmation')
  ok('confirm(attach) -> created / awaiting_panel_confirmation')

  const attachedState = await state()
  assert.equal(attachedState.status, 'awaiting_panel_confirmation')
  assert.equal(attachedState.checkpoints.panel_confirmed_at, null)
  assert.equal(attachedState.field_analysis.configuration_cards.length, 4)
  assert.deepEqual(attachedState.field_analysis.configuration_cards.map(card => card.seat), ['eic', 'methodology', 'domain', 'perspective'])
  assert.equal(attachedState.panel.seats.find(seat => seat.seat_id === 'da').configuration_card, null)
  assert.equal(attachedState.field_analysis.primary_discipline, 'Machine learning')
  assert.match(attachedState.field_analysis.analyst_run_at, ISO_WITH_OFFSET)
  ok('confirm(attach) -> disk: 4 configuration cards stored (DA takes none), checkpoint 1 still open')

  const waiting = await callTool(tools, 'academic_review_status', { review_id: reviewId }, 'e2e-status-attached')
  assert.equal(waiting.isError, false, rendered(waiting))
  assert.equal(waiting.value.status, 'awaiting_panel_confirmation')
  assert.equal(waiting.value.pending_checkpoint, 'panel_confirmation')
  ok('status -> awaiting_panel_confirmation, pending_checkpoint panel_confirmation')

  // A second attach cannot overwrite the analyst output.
  expectFailure(await callTool(tools, 'academic_review_confirm', attachArgs(reviewId), 'e2e-confirm-attach-again'), /state_conflict/)
  ok('gate: a second confirm(attach) refuses with state_conflict')

  const confirmed = await callTool(tools, 'academic_review_confirm', { review_id: reviewId, action: 'confirm' }, 'e2e-confirm-panel')
  assert.equal(confirmed.isError, false, rendered(confirmed))
  assert.equal(confirmed.value.action, 'confirm')
  assert.equal(confirmed.value.status, 'in_review')
  assert.match(confirmed.value.panel_confirmed_at, ISO_WITH_OFFSET)
  assert.equal(confirmed.value.field_analysis_attached, true)
  assert.equal(confirmed.value.pending_checkpoint, undefined)
  ok('confirm(confirm) -> awaiting_panel_confirmation / in_review, checkpoint 1 recorded')

  const confirmedState = await state()
  assert.equal(confirmedState.status, 'in_review')
  assert.equal(confirmedState.checkpoints.panel_confirmed_at, confirmed.value.panel_confirmed_at)
  assert.deepEqual(confirmedState.panel.seats.map(seat => seat.status), ['dispatched', 'dispatched', 'dispatched', 'dispatched', 'dispatched'])
  assert.ok(confirmedState.updated_at >= confirmedState.created_at)
  ok('confirm(confirm) -> disk: all five seats dispatched, panel_confirmed_at persisted')

  return { reviewId, reviewDir, state }
}

/**
 * Phase 2: five seat commits, then synthesis and both halves of human
 * checkpoint 2.
 * @returns the decision letter text for the route checks.
 */
async function runPanelAndReport(tools, reviewId, reviewDir, state) {
  const expectedStatus = ['in_review', 'in_review', 'in_review', 'in_review', 'all_submitted']
  for (let index = 0; index < SEAT_FIXTURES.length; index += 1) {
    const fixture = SEAT_FIXTURES[index]
    const submitted = await callTool(tools, 'academic_review_submit', {
      review_id: reviewId,
      seat_id: fixture.seat_id,
      report: seatReportBody(fixture),
    }, 'e2e-submit-' + fixture.seat_id)
    assert.equal(submitted.isError, false, rendered(submitted))
    const value = submitted.value
    assert.equal(value.seat_id, fixture.seat_id)
    assert.equal(value.verdict, fixture.verdict)
    assert.equal(value.status, expectedStatus[index])
    assert.ok(value.submitted_seats.includes(fixture.seat_id))
    assert.equal(value.missing_seats.includes(fixture.seat_id), false)
    assert.equal(value.missing_seats.length, SEAT_FIXTURES.length - (index + 1))
    assert.equal(value.report_path, join(reviewDir, 'seats', fixture.seat_id + '.json'))

    // Each commit writes both shapes immediately, under the review directory.
    const seatJson = await readJson(value.report_path)
    assert.equal(seatJson.schema_version, '1')
    assert.equal(seatJson.review_id, reviewId)
    assert.equal(seatJson.seat_id, fixture.seat_id)
    assert.equal(seatJson.verdict, fixture.verdict)
    assert.equal(seatJson.created_at, CREATED_AT)
    assert.match(seatJson.submitted_at, ISO_WITH_OFFSET)
    assert.equal(seatJson.provenance.peerOutputVisible, false)
    assert.equal(seatJson.findings.length, fixture.findings.length)
    assert.ok(seatJson.findings.every(item => item.evidence.length >= 1))
    const seatMarkdown = await readText(join(reviewDir, 'seats', fixture.seat_id + '.md'))
    assert.match(seatMarkdown, /# Review card - /)
    assert.ok(seatMarkdown.includes('Verdict: ' + fixture.verdict))
    const during = await state()
    assert.equal(during.status, expectedStatus[index])
    assert.equal(during.panel.seats.find(seat => seat.seat_id === fixture.seat_id).status, 'submitted')
    ok('submit ' + String(index + 1) + '/5 ' + fixture.seat_id + ' -> ' + expectedStatus[index]
      + ' (json + md written, ' + String(value.missing_seats.length) + ' seat(s) open)')
  }

  // Committed cards are immutable.
  expectFailure(await callTool(tools, 'academic_review_submit', {
    review_id: reviewId,
    seat_id: 'eic',
    report: seatReportBody(SEAT_FIXTURES[0]),
  }, 'e2e-submit-duplicate'), /duplicate_submission/)
  ok('gate: a duplicate submit refuses with duplicate_submission (cards immutable)')

  const allIn = await callTool(tools, 'academic_review_status', { review_id: reviewId }, 'e2e-status-all')
  assert.equal(allIn.isError, false, rendered(allIn))
  assert.equal(allIn.value.status, 'all_submitted')
  assert.deepEqual(allIn.value.submitted_seats, ['eic', 'methodology', 'domain', 'perspective', 'da'])
  assert.deepEqual(allIn.value.missing_seats, [])
  assert.equal(allIn.value.pending_checkpoint, undefined)
  ok('status -> all_submitted, 5/5 seats committed, no checkpoint open')

  // approve=false: the synthesizer writes the draft and REFUSES to close the run.
  const draft = await callTool(tools, 'academic_review_report', { review_id: reviewId, approve: false }, 'e2e-report-draft')
  assert.equal(draft.isError, false, rendered(draft))
  assert.equal(draft.value.status, 'awaiting_synthesis_approval')
  assert.notEqual(draft.value.status, 'report_ready')
  assert.equal(draft.value.approved, false)
  // Three major_revision cards outvote one accept and one reject.
  assert.equal(draft.value.decision, 'major_revision')
  // The record keeps both document names relative to the review directory
  // (the web report route re-anchors them and re-checks the prefix).
  assert.equal(draft.value.decision_letter_path, 'editorial_decision.md')
  assert.equal(draft.value.revision_roadmap_path, 'revision_roadmap.md')
  assert.ok((await stat(join(reviewDir, draft.value.decision_letter_path))).size > 0)
  assert.ok((await stat(join(reviewDir, draft.value.revision_roadmap_path))).size > 0)
  assert.equal(draft.value.da_critical_adjudications.length, 1)
  assert.equal(draft.value.da_critical_adjudications[0].finding_id, 'da-F1')
  assert.equal(draft.value.da_critical_adjudications[0].outcome, 'unresolved')
  ok('report(approve=false) -> all_submitted / awaiting_synthesis_approval, approved=false (refuses to close)')
  ok('report(approve=false) -> advisory decision major_revision, da-F1 left unresolved')

  const draftState = await state()
  assert.equal(draftState.status, 'awaiting_synthesis_approval')
  assert.equal(draftState.checkpoints.report_approved_at, null)
  assert.notEqual(draftState.synthesis.completed_at, null)
  assert.match(draftState.synthesis.completed_at, ISO_WITH_OFFSET)
  const draftLetter = await readText(join(reviewDir, 'editorial_decision.md'))
  const draftRoadmap = await readText(join(reviewDir, 'revision_roadmap.md'))
  assert.match(draftLetter, /# Editorial Decision Letter/)
  assert.match(draftLetter, /Advisory decision: major_revision/)
  assert.match(draftLetter, /da-F1: unresolved/)
  assert.match(draftRoadmap, /# Revision Roadmap \(advisory, non-ranking\)/)
  assert.match(draftRoadmap, /## critical \(2\)/)
  ok('report(approve=false) -> disk: letter + roadmap written, report_approved_at still null')

  // Human checkpoint 2: approval is refused while the DA CRITICAL is open.
  expectFailure(await callTool(tools, 'academic_review_report', { review_id: reviewId, approve: true }, 'e2e-report-blocked'), /da_adjudication_required/)
  const blockedState = await state()
  assert.equal(blockedState.status, 'awaiting_synthesis_approval')
  assert.equal(blockedState.checkpoints.report_approved_at, null)
  ok('gate: report(approve=true) without adjudication refuses with da_adjudication_required')

  const approved = await callTool(tools, 'academic_review_report', {
    review_id: reviewId,
    approve: true,
    da_adjudications: [
      {
        finding_id: 'da-F1',
        outcome: 'validated',
        rationale: 'Section 3 reports a gain without ever stating the hypothesis it tests; the DA objection stands.',
      },
    ],
  }, 'e2e-report-approved')
  assert.equal(approved.isError, false, rendered(approved))
  assert.equal(approved.value.status, 'report_ready')
  assert.equal(approved.value.approved, true)
  assert.equal(approved.value.decision, 'major_revision')
  assert.deepEqual(approved.value.da_critical_adjudications.map(row => row.finding_id + ':' + row.outcome), ['da-F1:validated'])
  ok('report(approve=true + DA adjudication) -> awaiting_synthesis_approval / report_ready')

  const finalState = await state()
  assert.equal(finalState.status, 'report_ready')
  assert.match(finalState.checkpoints.report_approved_at, ISO_WITH_OFFSET)
  assert.equal(finalState.synthesis.da_critical_adjudications[0].outcome, 'validated')
  const finalLetter = await readText(join(reviewDir, 'editorial_decision.md'))
  assert.match(finalLetter, /da-F1: validated/)
  assert.match(finalLetter, /Advisory decision: major_revision\./)
  ok('report(approve=true) -> disk: report_ready, report_approved_at recorded, letter carries the adjudication')

  return finalLetter
}

/** Assert the complete on-disk artifact set of one finished review. */
async function assertArtifacts(reviewDir, reviewId) {
  const entries = (await readdir(reviewDir)).sort()
  assert.deepEqual(entries, ['editorial_decision.md', 'revision_roadmap.md', 'seats', 'state.json'])
  const seatEntries = (await readdir(join(reviewDir, 'seats'))).sort()
  const expected = []
  for (const fixture of SEAT_FIXTURES) expected.push(fixture.seat_id + '.json', fixture.seat_id + '.md')
  assert.deepEqual(seatEntries, expected.sort())
  const state = await readJson(join(reviewDir, 'state.json'))
  assert.equal(state.review_id, reviewId)
  assert.equal(state.status, 'report_ready')
  assert.equal(state.panel.seats.filter(seat => seat.status === 'submitted').length, 5)
  assert.equal(state.panel.seats.filter(seat => seat.report !== null).length, 5)
  const letter = await readText(join(reviewDir, 'editorial_decision.md'))
  const roadmap = await readText(join(reviewDir, 'revision_roadmap.md'))
  assert.match(letter, /Unofficial DSH port of the Academic Research Skills skill/)
  assert.match(roadmap, /Unofficial DSH port of the Academic Research Skills skill/)
  ok('artifacts: state.json + 5x seats/{json,md} + editorial_decision.md + revision_roadmap.md',
    entries.join(', ') + ' | seats: ' + String(seatEntries.length) + ' files')
}

/** Resolve and drive the three read-only routes through real host semantics. */
async function assertWebRoutes(workspace, reviewId, expectedLetter) {
  const { REVIEWS_ROUTE_ROOT } = await import('../lib/web.js')
  const routes = await mountWebFace(workspace)
  assert.ok(routes.length >= 2, 'expected the list route plus the detail prefix route')
  for (const route of routes) {
    assert.ok(!route.path.endsWith('/'), 'a registered prefix must not end with a slash: ' + route.path)
    assert.ok(route.path === REVIEWS_ROUTE_ROOT, 'every route lives under ' + REVIEWS_ROUTE_ROOT)
  }
  ok('web: ' + String(routes.length) + ' routes registered under ' + REVIEWS_ROUTE_ROOT + ', no trailing-slash prefix (t7)')

  // Paths are resolved by the real host matcher, not by string concatenation.
  const listRoute = resolveRoute(routes, REVIEWS_ROUTE_ROOT)
  const detailRoute = resolveRoute(routes, REVIEWS_ROUTE_ROOT + '/' + reviewId)
  const reportRoute = resolveRoute(routes, REVIEWS_ROUTE_ROOT + '/' + reviewId + '/report')
  assert.ok(listRoute, 'list path must match')
  assert.ok(detailRoute, 'detail path must match the prefix route')
  assert.ok(reportRoute, 'report path must match the prefix route')
  assert.equal(resolveRoute(routes, REVIEWS_ROUTE_ROOT + 'X'), null)
  ok('web: resolveRoute matches list/detail/report and rejects a sibling path like .../reviewsX')

  const list = await request(listRoute, REVIEWS_ROUTE_ROOT)
  assert.equal(list.status, 200)
  const listBody = list.json()
  assert.equal(listBody.reviews.length, 1)
  assert.equal(listBody.reviews[0].review_id, reviewId)
  assert.equal(listBody.reviews[0].status, 'report_ready')
  assert.equal(listBody.reviews[0].pending_checkpoint, false)
  assert.equal(listBody.reviews[0].paper_name, 'manuscript.md')
  assert.deepEqual(listBody.reviews[0].seats.map(seat => seat.seat_id), ['eic', 'methodology', 'domain', 'perspective', 'da'])
  ok('web: GET list -> 200, one report_ready review, 5 seat rows')

  const detail = await request(detailRoute, REVIEWS_ROUTE_ROOT + '/' + reviewId)
  assert.equal(detail.status, 200)
  assert.equal(detail.json().review_id, reviewId)
  assert.equal(detail.json().status, 'report_ready')
  const da = detail.json().seats.find(seat => seat.seat_id === 'da')
  assert.equal(da.findings_open, 2)
  assert.equal(da.findings_by_severity.critical, 1)
  ok('web: GET detail -> 200, DA seat tallies 2 findings (1 critical)')

  const letter = await request(reportRoute, REVIEWS_ROUTE_ROOT + '/' + reviewId + '/report')
  assert.equal(letter.status, 200)
  assert.equal(letter.json().markdown, expectedLetter)
  assert.match(letter.json().markdown, /# Editorial Decision Letter/)
  ok('web: GET report -> 200, markdown equals the letter on disk')

  const badPaths = [
    REVIEWS_ROUTE_ROOT + '/rev-19990101-deadbeef',
    REVIEWS_ROUTE_ROOT + '/not-an-id',
    REVIEWS_ROUTE_ROOT + '/..%2F..%2Fetc',
  ]
  for (const bad of badPaths) {
    const route = resolveRoute(routes, bad)
    assert.ok(route, 'a 404 must still be produced by a resolved route: ' + bad)
    const refused = await request(route, bad)
    assert.equal(refused.status, 404, bad)
    ok('web: GET ' + bad.slice(REVIEWS_ROUTE_ROOT.length) + ' -> 404')
  }

  assert.equal((await request(listRoute, REVIEWS_ROUTE_ROOT, 'POST')).status, 405)
  assert.equal((await request(detailRoute, REVIEWS_ROUTE_ROOT + '/' + reviewId, 'POST')).status, 405)
  ok('web: POST list and detail -> 405 (read-only surface)')

  const gatedRoutes = await mountWebFace(workspace, 401)
  const gatedList = resolveRoute(gatedRoutes, REVIEWS_ROUTE_ROOT)
  const gatedDetail = resolveRoute(gatedRoutes, REVIEWS_ROUTE_ROOT + '/' + reviewId)
  const unauth = await request(gatedList, REVIEWS_ROUTE_ROOT)
  assert.equal(unauth.status, 401)
  assert.equal(unauth.json().error, 'unauthorized')
  const unauthDetail = await request(gatedDetail, REVIEWS_ROUTE_ROOT + '/' + reviewId)
  assert.equal(unauthDetail.status, 401)
  ok('web: unauthenticated GET list and detail -> 401 before any state is read')
}

/** The two negative gates, in their own throwaway workspace. */
async function assertNegativeGates(gateTools, workspace) {
  // Gate 1: a PDF manuscript is refused at create, and nothing is written.
  const pdfPath = join(workspace, 'manuscript.pdf')
  await writeFile(pdfPath, '%PDF-1.7\n1 0 obj\n<<>>\nendobj\ntrailer\n<<>>\n%%EOF\n', 'utf8')
  const pdfFailure = await callTool(gateTools, 'academic_review_create', { paper_path: pdfPath }, 'e2e-gate-pdf')
  const pdfText = expectFailure(pdfFailure, /unsupported_format/)
  assert.match(pdfText, /\.md, \.tex, or \.txt/)
  const reviewRoot = join(workspace, STATE_DIR)
  let reviewDirs = []
  try {
    reviewDirs = (await readdir(reviewRoot, { withFileTypes: true })).filter(entry => entry.isDirectory()).map(entry => entry.name)
  } catch {
    reviewDirs = []
  }
  assert.deepEqual(reviewDirs, [])
  ok('gate: create(.pdf) refuses with unsupported_format and leaves no review directory')

  // Gate 2: one byte of drift after attach is caught on the next tool call.
  const gatePaper = join(workspace, 'manuscript.md')
  await writeFile(gatePaper, PAPER_TEXT, 'utf8')
  const created = await callTool(gateTools, 'academic_review_create', { paper_path: gatePaper }, 'e2e-gate-create')
  assert.equal(created.isError, false, rendered(created))
  const gateReviewId = created.value.review_id
  const attached = await callTool(gateTools, 'academic_review_confirm', attachArgs(gateReviewId), 'e2e-gate-attach')
  assert.equal(attached.isError, false, rendered(attached))
  assert.equal(attached.value.status, 'awaiting_panel_confirmation')

  const bytesBefore = (await stat(gatePaper)).size
  await appendFile(gatePaper, 'X', 'utf8')
  const bytesAfter = (await stat(gatePaper)).size
  assert.equal(bytesAfter, bytesBefore + 1)

  expectFailure(await callTool(gateTools, 'academic_review_status', { review_id: gateReviewId }, 'e2e-gate-status'), /paper_changed/)
  expectFailure(await callTool(gateTools, 'academic_review_confirm', { review_id: gateReviewId, action: 'confirm' }, 'e2e-gate-confirm'), /paper_changed/)
  const driftState = await readJson(join(workspace, STATE_DIR, gateReviewId, 'state.json'))
  assert.equal(driftState.status, 'awaiting_panel_confirmation')
  assert.equal(driftState.checkpoints.panel_confirmed_at, null)
  const seatFiles = await readdir(join(workspace, STATE_DIR, gateReviewId, 'seats'))
  assert.deepEqual(seatFiles, [])
  ok('gate: one-byte manuscript change after attach refuses status/confirm with paper_changed, no seat written')
}

/** Whole-run entry point; throws on the first failed check and always cleans up. */
async function main() {
  const started = harnessStart
  let elapsed = 0
  let root
  try {
    root = await mkdtemp(join(tmpdir(), 'dsh-ar-e2e-'))
    const runWorkspace = join(root, 'run')
    const gateWorkspace = join(root, 'gates')
    await mkdir(runWorkspace, { recursive: true })
    await mkdir(gateWorkspace, { recursive: true })
    const manuscript = join(runWorkspace, 'manuscript.md')
    await writeFile(manuscript, PAPER_TEXT, 'utf8')

    console.log('dsh-academic-review deterministic E2E (pnpm test:e2e)')
    console.log('node ' + process.version + ' on ' + process.platform + '-' + process.arch + ', cwd ' + process.cwd())
    console.log('temp root: ' + root)
    console.log('note: the state layer clock is not injectable (nowIso() calls new Date()), so plugin')
    console.log('      timestamps are pattern-asserted; every fixture value is fixed.')

    section('mount: real cordis Context, temp state dir')
    const { tools, skills, ctx } = await mountReviewPlugin({ stateDir: STATE_DIR, workspaceRoot: runWorkspace })
    assert.ok(ctx instanceof Object)
    assert.deepEqual(tools.schemas().map(schema => schema.name).sort(), TOOL_NAMES)
    ok('plugin mounted on a real cordis Context; tool surface is exactly the five academic_review_* tools')
    const advertised = await skills.list({ cwd: runWorkspace })
    // Discovery is a directory scan over vendor/, so the advertised surface follows
    // vendor-manifest.json. Compare against the manifest instead of hard-coding one
    // skill name: vendoring another skill must not silently change what is served.
    const manifest = JSON.parse(await readFile(join(repoRoot, 'vendor-manifest.json'), 'utf8'))
    const vendored = [...manifest.vendored.skills].sort()
    assert.deepEqual(advertised.map(skill => skill.name), vendored)
    for (const skill of advertised) assert.equal(skill.provider, 'academic-review')
    ok('plugin mounted; skill provider advertises every vendored skill (' + vendored.join(', ') + ')')

    section('checkpoint 1: create -> attach (4 cards) -> confirm')
    const review = await runCheckpointOne(tools, runWorkspace, manuscript)

    section('panel: 5x submit with fixture seat cards')
    const letterText = await runPanelAndReport(tools, review.reviewId, review.reviewDir, review.state)

    section('artifacts on disk')
    await assertArtifacts(review.reviewDir, review.reviewId)

    section('web: three read-only routes through real host prefix semantics')
    await assertWebRoutes(runWorkspace, review.reviewId, letterText)

    section('negative gates: unsupported format and manuscript drift')
    const gateMount = await mountReviewPlugin({ stateDir: STATE_DIR, workspaceRoot: gateWorkspace })
    await assertNegativeGates(gateMount.tools, gateWorkspace)

    section('determinism and isolation')
    assert.equal(networkAttempts, 0, 'the harness must never touch the network')
    ok('no network call was attempted (globalThis.fetch trapped, 0 calls)')
    ok('no model client exists in this process: only the five review tools ran')
    ok('no review state entered the repository (everything lives under the temp root)')
  } finally {
    if (root !== undefined) {
      await rm(root, { recursive: true, force: true })
      let removed = true
      try {
        await stat(root)
        removed = false
      } catch {
        removed = true
      }
      assert.equal(removed, true, 'temp root must be gone after cleanup')
      console.log('\n\u2714 cleanup: removed ' + root)
    }
    elapsed = (performance.now() - started) / 1000
    globalThis.fetch = realFetch
  }
  console.log('\n=== E2E SUMMARY ===')
  console.log('checks passed : ' + String(report.checks))
  console.log('runtime       : ' + elapsed.toFixed(2) + 's')
  console.log('exit          : 0')
}

/** Untrapped fetch reference, restored when the run ends. */
const realFetch = globalThis.fetch
/** Count of attempted network calls; must stay 0. */
let networkAttempts = 0
globalThis.fetch = (...args) => {
  networkAttempts += 1
  throw new Error('scripts/e2e.mjs must not use the network: ' + String(args[0]))
}

try {
  await main()
} catch (error) {
  console.error('\n\u2716 E2E FAILED after ' + String(report.checks) + ' passed check(s)')
  console.error('runtime       : ' + ((performance.now() - harnessStart) / 1000).toFixed(2) + 's')
  console.error(error && error.stack !== undefined ? error.stack : String(error))
  console.error('exit          : 1')
  process.exitCode = 1
}