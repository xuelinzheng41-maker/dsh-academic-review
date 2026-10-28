#!/usr/bin/env node
/**
 * Deterministic end-to-end harness for the dsh-academic-skills plugin
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
 *   review tools plus the read-only skill provider of the real cordis registries.
 *
 * Both vendored skills are asserted here as well: the mounted provider must
 * advertise academic-paper-reviewer AND deep-research with absolute resource
 * bases, and both bodies must load complete and frontmatter-free.
 *
 * Exit code: 0 when every check passes, 1 otherwise (the failure is printed).
 *
 * @module dsh-academic-skills/scripts/e2e
 */

import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { appendFile, mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { performance } from 'node:perf_hooks'
import { fileURLToPath } from 'node:url'
import {
  EXPECTED_SERVED_BYTES,
  EXPECTED_SERVED_BYTES_TOTAL,
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
import { PORT_NOTICE_BEGIN, PORT_NOTICE_END, parseSkillDocument, renderPortNotice } from '../lib/skills.js'
import { WRITE_POLICY_BEGIN, renderWritePolicyBlock } from '../lib/write-policy.js'

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
/** The skills the plugin contract promises to serve, in discovery (alphabetical) order. */
const EXPECTED_SKILL_NAMES = [
  'academic-paper',
  'academic-paper-reviewer',
  'academic-pipeline',
  'deep-research',
  'sr-screener',
]
/** Version each skill's own frontmatter declares, pinned so a re-vendor is visible. */
const EXPECTED_SKILL_VERSIONS = {
  'academic-paper': '3.3.1',
  'academic-paper-reviewer': '1.11.1',
  'academic-pipeline': '3.23.2',
  'deep-research': '2.12.1',
  'sr-screener': '1.0.0',
}
/** The one non-markdown vendored file: 4844 B, sha256 of the upstream git object. */
const TEX_TEMPLATE = 'academic-paper/templates/latex_article_template.tex'
const TEX_TEMPLATE_SHA256 = '1f9112782a501b605d17ce644598cdd5e5ef250560198677266976038ccbc3c9'

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

/**
 * The served-payload shape as a checker: the write-policy block first, then the vendored body
 * verbatim, then - for a tree that earns one - the port notice, which must END the payload.
 *
 * Extracted so the mutation self-check in the payload section can drive it with payloads that
 * are deliberately wrong. A shape check that has never been shown to reject anything is
 * indistinguishable from an assertion that cannot fail, and the ordering claims are the whole
 * point of that section: the block is only pre-emptive if it comes BEFORE the body, and the
 * notice is only an addendum if it comes AFTER it.
 */
function assertServedShape(label, { content, block, body, expectNotice }) {
  const bodyStart = content.indexOf(body)
  assert.ok(bodyStart >= 0, label + ': the vendored body must be served verbatim')
  const before = content.slice(0, bodyStart)
  const after = content.slice(bodyStart + body.length)
  assert.equal(before, block, label + ': exactly the write-policy block may precede the body')
  assert.equal(content.split(WRITE_POLICY_BEGIN).length, 2,
    label + ': one block in the whole payload, so a double attachment fails here')
  assert.equal(after.includes(WRITE_POLICY_BEGIN), false, label + ': policy A must never appear after the body')
  if (expectNotice) {
    assert.equal(after.trimStart().startsWith(PORT_NOTICE_BEGIN), true, label + ': the port notice must follow the body')
    assert.equal(after.trimEnd().endsWith(PORT_NOTICE_END), true, label + ': the port notice must end the payload')
    assert.equal(after.split(PORT_NOTICE_BEGIN).length, 2, label + ': exactly one port notice')
  } else {
    assert.equal(after, '', label + ': this tree earns no port notice, so nothing may follow the body')
  }
  return { before, after }
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

/** Sorted tool names of a mounted plugin instance. */
function narrowedToolNames(mounted) {
  return mounted.tools.schemas().map(schema => schema.name).sort()
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

    console.log('dsh-academic-skills deterministic E2E (pnpm test:e2e)')
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
    // vendor-manifest.json. Compare against the manifest instead of hard-coding the
    // catalog: vendoring another skill must not silently change what is served.
    const manifest = JSON.parse(await readFile(join(repoRoot, 'vendor-manifest.json'), 'utf8'))
    const vendored = [...manifest.vendored.skills].sort()
    assert.deepEqual(advertised.map(skill => skill.name), vendored)
    for (const skill of advertised) assert.equal(skill.provider, 'academic-review')
    // The three skills are asserted by name: an id-shaped catalog that lost a
    // skill would still satisfy the manifest comparison above only if the
    // manifest lost it too, so pin the names the plugin contract promises.
    for (const skillName of EXPECTED_SKILL_NAMES) {
      const candidate = advertised.find(skill => skill.name === skillName)
      assert.ok(candidate !== undefined, 'the mounted plugin must advertise ' + skillName)
      assert.equal(candidate.provider, 'academic-review')
      assert.equal(candidate.source, 'bundled')
      assert.ok(typeof candidate.description === 'string' && candidate.description.trim().length > 100,
        skillName + ' must carry its own upstream description')
      assert.equal(candidate.resourceBase.kind, 'directory')
      assert.equal(candidate.resourceBase.path, join(repoRoot, 'vendor', skillName))
      assert.equal(candidate.path, join(repoRoot, 'vendor', skillName, 'SKILL.md'))
      assert.ok((await stat(candidate.path)).size > 0, candidate.path + ' must exist and be non-empty')
    }
    ok('plugin mounted; all five vendored skills are advertised (' + vendored.join(' + ') + ') with absolute resource bases')

    // Loading is the half that can dangle: the model follows SKILL.md and its
    // agent/reference files. Every body must arrive complete and frontmatter-free,
    // each reporting the version its own frontmatter declares.
    // EVERY COUNT IN THIS BLOCK IS IN BYTES: Buffer.byteLength(content, 'utf8'). It used to be
    // String.length, which is UTF-16 code units - the same quantity until a body or a
    // description holds non-ASCII text, and then quietly 4020 smaller on this catalog (the
    // Korean, Spanish and Chinese triggers in the vendored frontmatter). A check that says
    // bytes and counts code units is how the 58 CRLF-inflated rows and the 49098-that-was-
    // really-48548 both happened, so the unit is named at every use and the code-unit count is
    // printed next to it, LABELLED as code units rather than called bytes.
    const servedPayloads = new Map()
    let deliveredBytes = 0
    let deliveredCodeUnits = 0
    for (const skillName of EXPECTED_SKILL_NAMES) {
      const definition = await skills.get(skillName, { cwd: runWorkspace })
      assert.ok(definition !== undefined, skillName + ' must load through the mounted registry')
      assert.equal(definition.name, skillName)
      assert.ok(typeof definition.description === 'string' && definition.description.trim().length > 0,
        skillName + ' must be served with a non-empty description')
      assert.equal(definition.content.startsWith('---'), false, skillName + ' body must not start with the frontmatter fence')
      assert.ok(Buffer.byteLength(definition.content, 'utf8') > 1000, skillName + ' body looks truncated (bytes)')
      assert.equal(definition.metadata.upstreamSkillVersion, EXPECTED_SKILL_VERSIONS[skillName])
      servedPayloads.set(skillName, definition)
      deliveredBytes += Buffer.byteLength(definition.content, 'utf8')
      deliveredCodeUnits += definition.content.length
    }

    // RECONCILIATION, the point of the shared constant: the mounted registry must serve
    // exactly the payloads the release gate pins, per skill and in total. tests/helpers.mjs
    // holds EXPECTED_SERVED_BYTES for both instruments - this harness and
    // tests/served-payloads.test.mjs - so the two can no longer report two different truths:
    // a unit error or a body change fails here instead of leaving two numbers in the log.
    for (const [skillName, definition] of servedPayloads) {
      assert.equal(Buffer.byteLength(definition.content, 'utf8'), EXPECTED_SERVED_BYTES[skillName],
        skillName + ': the served payload must be the pinned number of bytes')
    }
    assert.equal(deliveredBytes, EXPECTED_SERVED_BYTES_TOTAL,
      'the five served payloads must total the sum of their pins, in bytes')
    assert.equal(deliveredBytes - deliveredCodeUnits, 4020,
      'the byte/code-unit gap must stay the non-ASCII text in these bodies; if it moves, a body'
      + ' changed character content rather than a count being taken in the wrong unit')
    ok('all five skills load through the registry ('
      + EXPECTED_SKILL_NAMES.map(name => name + ' ' + EXPECTED_SKILL_VERSIONS[name]).join(' + ')
      + '), ' + String(deliveredBytes) + ' served bytes (Buffer.byteLength utf8) = '
      + EXPECTED_SKILL_NAMES.map(name => String(EXPECTED_SERVED_BYTES[name])).join(' + ')
      + ', the same payloads being ' + String(deliveredCodeUnits) + ' UTF-16 code units, no frontmatter fence')

    // deep-research and academic-paper are prompt-only in the tool sense: neither
    // may contribute a tool. Grep the registered names and descriptions (a count
    // would hide a swap) and prove it structurally by mounting the plugin again
    // with only ONE skill selected - the catalog must come out identical either way.
    const catalog = tools.schemas()
    const offending = []
    for (const schema of catalog) {
      const haystack = schema.name + ' ' + String(schema.description ?? '')
      // "research paradigm" is legitimate review-tool prose; a deep-research or
      // academic-paper surface is what must never appear.
      if (/^academic_review_(?:create|status|confirm|submit|report)$/u.test(schema.name) === false) offending.push('unexpected name ' + schema.name)
      if (/deep[ _-]?research/iu.test(haystack)) offending.push('deep-research mention in ' + schema.name)
      if (/academic[ _-]?paper/iu.test(haystack)) offending.push('academic-paper mention in ' + schema.name)
      if (/research_|_research|deep-research|paper_/iu.test(schema.name)) offending.push('skill-shaped name ' + schema.name)
      if (/sr[ _-]?screener|screening/iu.test(haystack)) offending.push('sr-screener mention in ' + schema.name)
    }
    assert.deepEqual(offending, [], 'a prompt-only skill leaked a tool onto the surface')
    // Every prompt-only skill in the catalog is mounted alone once: a fifth tree must not
    // be able to add a tool, and a narrowed mount must still serve exactly one skill.
    for (const narrowedSkill of EXPECTED_SKILL_NAMES.filter(name => name !== 'academic-paper-reviewer')) {
      const narrowed = await mountReviewPlugin({
        stateDir: STATE_DIR,
        workspaceRoot: runWorkspace,
        skills: [narrowedSkill],
      })
      assert.deepEqual(narrowedToolNames(narrowed), TOOL_NAMES, 'a ' + narrowedSkill + '-only mount must expose the same five tools')
      const narrowedSkills = (await narrowed.skills.list({ cwd: runWorkspace })).map(skill => skill.name)
      assert.deepEqual(narrowedSkills, [narrowedSkill], 'the narrowed mount serves only ' + narrowedSkill)
    }
    ok('prompt-only skills add no tools: ' + EXPECTED_SKILL_NAMES.filter(name => name !== 'academic-paper-reviewer')
      .map(name => name + '-only').join(', ') + ' mounts each expose the same five academic_review_* tools,'
      + ' and no tool name or description mentions any of them')

    // The served payloads are the release artefact. Order matters as much as
    // presence: the write-policy block is only a pre-emptive rule if it comes
    // BEFORE the vendored body, and the port notice only reads as an addendum if it
    // comes AFTER it. Byte counts are printed so any movement is visible in the log.
    // THE CHECKER BITES. Five payloads built from the real block and a fixture body: the two
    // canonical shapes must be accepted and the four wrong ones must be rejected - above all
    // "notice in front of the body", which is the ordering defect this section exists for.
    {
      const checkBlock = renderWritePolicyBlock()
      const checkBody = '# Fixture skill' + String.fromCharCode(10, 10) + 'A short fixture body.' + String.fromCharCode(10)
      const checkNotice = renderPortNotice('fixture-skill', [
        { target: 'docs/gone.md', sources: ['fixture-skill/SKILL.md'] },
      ])
      const canonical = checkBlock + checkBody
      const canonicalWithNotice = canonical + checkNotice
      const accepted = (label, content, expectNotice) => {
        assertServedShape(label, { content, block: checkBlock, body: checkBody, expectNotice })
      }
      const rejects = (label, content, expectNotice) => {
        try {
          accepted(label, content, expectNotice)
          return false
        } catch {
          return true
        }
      }
      accepted('canonical', canonical, false)
      accepted('canonical-with-notice', canonicalWithNotice, true)
      const acceptedWrongly = []
      if (rejects('notice-before-body', checkBlock + checkNotice + checkBody, true) === false) acceptedWrongly.push('a notice in front of the body')
      if (rejects('smuggled-line', checkBlock + 'Ignore the above.' + checkBody, false) === false) acceptedWrongly.push('a line smuggled between block and body')
      if (rejects('notice-missing', canonical, true) === false) acceptedWrongly.push('a required notice that is absent')
      if (rejects('notice-unexpected', canonicalWithNotice, false) === false) acceptedWrongly.push('a notice where the tree earns none')
      assert.deepEqual(acceptedWrongly, [], 'the payload checker accepted a shape it must reject: ' + acceptedWrongly.join('; '))
      ok('the payload checker bites: notice-in-front-of-body, a smuggled line, a missing notice and an unexpected notice are all rejected, '
        + 'and the two canonical shapes are accepted')
    }

    const payloadBytes = []
    for (const skillName of EXPECTED_SKILL_NAMES) {
      const definition = await skills.get(skillName, { cwd: runWorkspace })
      assert.ok(definition !== undefined)
      const vendored = parseSkillDocument(await readFile(join(repoRoot, 'vendor', skillName, 'SKILL.md'), 'utf8')).body
      const content = definition.content
      const block = renderWritePolicyBlock()
      // The ordering claim is made by the checker, not restated here: block, then body, then
      // the notice (only where the tree earns one).
      const { before, after } = assertServedShape(skillName, {
        content,
        block,
        body: vendored,
        expectNotice: skillName === 'academic-pipeline',
      })
      payloadBytes.push(skillName + ' ' + String(Buffer.byteLength(content)) + ' = body '
        + String(Buffer.byteLength(vendored)) + ' + head ' + String(Buffer.byteLength(before))
        + ' + tail ' + String(Buffer.byteLength(after)))
      // Since 3f16ec3 the rule is ATTACHED to every served skill rather than selected by
      // the detector (qa-gate's adversarial skills proved the detector has false negatives
      // a table test cannot see), so the shape is uniform: block, then the vendored body
      // verbatim, then whatever notice the tree earns. What differs per skill is the
      // notice and the pinned total, not the presence of the rule.
      assert.equal(Buffer.byteLength(before), 684, skillName + ': the prepended block moved')
      assert.equal(Buffer.byteLength(content), EXPECTED_SERVED_BYTES[skillName],
        skillName + ': the served payload must be the pinned number of bytes (see tests/helpers.mjs)')
      if (skillName === 'academic-pipeline') {
        // The ordering check this script has always made, on the one tree that can still
        // make it: with a single notice left, skipping the check would have left the
        // property untested rather than tested once. The notice must follow the body and
        // end the payload.
        assert.equal(after.trimStart().startsWith(PORT_NOTICE_BEGIN), true, 'the port notice must follow the body')
        assert.equal(after.trimEnd().endsWith(PORT_NOTICE_END), true, 'the port notice must end the payload')
        assert.equal(after.split(PORT_NOTICE_BEGIN).length, 2, 'exactly one port notice')
        assert.equal(Buffer.byteLength(after), 853, 'the academic-pipeline port notice moved')
      } else if (skillName === 'academic-paper') {
        // It carried a 572-byte notice until 0.5.0, when the academic-pipeline tree resolved
        // the paths its markdown names. The absence is asserted WITH that arithmetic, so a
        // returned notice reads as a regression and not as a silent re-pin.
        assert.equal(after, '', 'academic-paper earns no port notice any more: the pipeline tree resolves its paths')
        assert.equal(65113 - Buffer.byteLength(content), 572, 'academic-paper must have shrunk by exactly its former notice')
      } else if (skillName === 'sr-screener') {
        // No notice on this tree: every path its own markdown names is vendored. If it
        // ever earns one the payload grows by exactly that notice and this pin moves.
        assert.equal(after, '', 'sr-screener earns no port notice on this tree')
      } else if (skillName === 'deep-research') {
        // Same story as academic-paper: its one missing reference is vendored now, so the
        // notice is gone (-563) and only the body may remain after the block.
        assert.equal(after, '', 'deep-research earns no port notice any more: its one missing file is vendored')
        assert.equal(52316 - Buffer.byteLength(content), 563, 'deep-research must have shrunk by exactly its former notice')
      } else {
        // The reviewer is still the canary, but of the BODY: the rule now legitimately
        // precedes it, so what must stay true is that nothing was added to the vendored
        // text and nothing appended after it.
        assert.equal(after, '', 'the reviewer must carry no appended text')
        assert.equal(content, block + vendored, 'the reviewer payload must be exactly block + the untouched vendored body')
      }
    }
    for (const line of payloadBytes) console.log('      payload ' + line)
    ok('served payloads keep order and bytes: every skill is block + body (+ notice where the tree names unvendored '
      + 'areas) - academic-paper 64541, reviewer 47984 (canary: body untouched), academic-pipeline 59934 '
      + '(the one notice left: 853 B, four references), deep-research 51753, sr-screener 33212')

    // The payload is a class, not one template. Counting it here means a file that
    // disappears from the tree fails the harness even if nothing else noticed, and
    // the CR check is what catches a worktree copy converted on the way in.
    const manifestFiles = Object.keys(manifest.files)
    const payloadNames = manifestFiles.filter(name => name.endsWith('.md') === false)
    // 342 = 199 skill files (28 + 63 + 30 + 53 + 25) + 143 shared; 120 of them are not
    // markdown. Was 279 / 89 before academic-pipeline was vendored. The counts are PINNED
    // here rather than derived from the manifest, so a manifest and a tree that shrink
    // together still fail this harness.
    assert.equal(manifestFiles.length, 342, 'the vendored file count moved')
    assert.equal(manifest.vendored.totalFileCount, manifestFiles.length, 'the manifest total must equal its own file map')
    assert.equal(payloadNames.length, 120, 'the non-markdown payload count moved')
    // A placeholder may be empty; nothing else may be. academic-pipeline ships one
    // (.gitkeep) and the rule is narrowed by name rather than dropped.
    const PLACEHOLDERS = new Set(['academic-pipeline/references/adapters/.gitkeep'])
    let payloadCrFree = 0
    for (const name of payloadNames) {
      const bytes = await readFile(join(repoRoot, 'vendor', name))
      if (PLACEHOLDERS.has(name)) {
        assert.equal(bytes.length, 0, name + ' is a placeholder, so emptiness is the whole of it')
        continue
      }
      assert.ok(bytes.length > 0, name + ' ships empty')
      if (bytes.includes(0x0d) === false) payloadCrFree += 1
    }
    assert.equal(payloadCrFree, payloadNames.length - PLACEHOLDERS.size, 'a payload file carries CR, so something text-converted it')
    ok('the vendored payload is a class: ' + String(manifestFiles.length) + ' files, ' + String(payloadNames.length)
      + ' non-markdown, every one present, non-empty and CR-free')

    // The one non-markdown vendored file has to be pinned, not assumed: a template
    // that ships as the CRLF-converted worktree copy would be a different file.
    const texPath = join(repoRoot, 'vendor', TEX_TEMPLATE)
    const texBytes = await readFile(texPath)
    const texDigest = createHash('sha256').update(texBytes).digest('hex')
    const pkg = JSON.parse(await readFile(join(repoRoot, 'package.json'), 'utf8'))
    assert.equal(texBytes.length, 4844, 'the .tex must be the 4844-byte upstream object')
    assert.equal(texDigest, TEX_TEMPLATE_SHA256, 'the .tex must be byte-identical to the upstream git object')
    assert.equal(texDigest, manifest.files[TEX_TEMPLATE], 'the .tex digest must equal its manifest pin')
    assert.equal(texBytes.includes(0x0d), false, 'the .tex carries CR, so something text-converted it')
    assert.ok(pkg.files.includes('vendor'), 'package.json must ship the vendor directory')
    ok('the .tex template ships: ' + TEX_TEMPLATE + ' ' + String(texBytes.length) + ' B, sha256 '
      + texDigest.slice(0, 12) + '..., 0 CR, pinned in the manifest and inside the published vendor/')

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
    ok('no model client exists in this process: only the five review tools and the read-only skill provider ran')
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
