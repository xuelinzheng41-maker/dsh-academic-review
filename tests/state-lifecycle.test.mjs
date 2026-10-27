/**
 * Lifecycle tests for the review state machine: transitions, the panel
 * checkpoint, duplicate and invalid submissions, paper pinning, and report
 * generation.
 */
import assert from 'node:assert/strict'
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import test from 'node:test'
import { ATTRIBUTION_LINE, ReviewStore } from '../lib/state.js'
import { fieldAnalysis, finding, makeWorkspace, rejectsCode, seatReport } from './helpers.mjs'

test('full-mode review walks every transition and writes the report documents', async t => {
  const workspace = await makeWorkspace('lifecycle')
  t.after(workspace.cleanup)
  const store = new ReviewStore({ workspace: workspace.root })

  const created = await store.create({ paperPath: workspace.paper })
  assert.equal(created.status, 'created')
  assert.equal(created.mode, 'full')
  assert.equal(created.panel.seats.length, 5)
  assert.deepEqual(created.panel.seats.map(seat => seat.seat_id), ['eic', 'methodology', 'domain', 'perspective', 'da'])
  assert.deepEqual(created.panel.seats.map(seat => seat.role_marker), ['EIC', 'R1', 'R2', 'R3', 'DA'])
  assert.equal(created.panel.seats[4].configuration_card, null)
  assert.match(created.paper.sha256, /^[0-9a-f]{64}$/)
  assert.equal(created.paper.format, 'md')

  // Human checkpoint 1: no seat may commit before the panel is confirmed.
  await rejectsCode(store.submit(created.review_id, 'eic', seatReport()), 'panel_not_confirmed')

  const configured = await store.attachFieldAnalysis(created.review_id, fieldAnalysis())
  assert.equal(configured.status, 'awaiting_panel_confirmation')
  const waiting = await store.status(created.review_id)
  assert.equal(waiting.pending_checkpoint, 'panel_confirmation')

  const confirmed = await store.confirmPanel(created.review_id)
  assert.equal(confirmed.status, 'in_review')
  assert.notEqual(confirmed.checkpoints.panel_confirmed_at, null)
  assert.deepEqual(confirmed.panel.seats.map(seat => seat.status), ['dispatched', 'dispatched', 'dispatched', 'dispatched', 'dispatched'])

  // Unknown seat id is refused before any write.
  await rejectsCode(store.submit(created.review_id, 'not-a-seat', seatReport()), 'invalid_seat_id')

  const verdicts = [
    ['eic', 'accept'],
    ['methodology', 'minor_revision'],
    ['domain', 'major_revision'],
    ['perspective', 'minor_revision'],
    ['da', 'reject'],
  ]
  for (const [seatId, verdict] of verdicts) {
    const findings = seatId === 'da'
      ? [finding('da-F1', { severity: 'critical', title: 'The central claim is not identified' })]
      : [finding(seatId + '-F1')]
    const result = await store.submit(created.review_id, seatId, seatReport({ verdict, findings }))
    assert.equal(result.report.seat_id, seatId)
    assert.equal(result.report.status, undefined)
    assert.equal(result.report.verdict, verdict)
  }

  const afterSeats = await store.status(created.review_id)
  assert.equal(afterSeats.status, 'all_submitted')
  assert.deepEqual(afterSeats.missing_seats, [])
  assert.equal(afterSeats.pending_checkpoint, null)

  // Committed seat reports are immutable.
  await rejectsCode(store.submit(created.review_id, 'eic', seatReport({ verdict: 'accept' })), 'duplicate_submission')

  const synthesis = await store.synthesize(created.review_id)
  assert.equal(synthesis.state.status, 'awaiting_synthesis_approval')
  assert.equal(synthesis.state.synthesis.decision, 'minor_revision')
  assert.equal(synthesis.state.synthesis.da_critical_adjudications.length, 1)
  assert.equal(synthesis.state.synthesis.da_critical_adjudications[0].outcome, 'unresolved')

  const letter = await readFile(join(synthesis.decisionLetterPath), 'utf8')
  const roadmap = await readFile(join(synthesis.roadmapPath), 'utf8')
  assert.match(letter, /# Editorial Decision Letter/)
  assert.match(letter, /Advisory decision: minor_revision/)
  assert.match(letter, /da-F1: unresolved/)
  assert.ok(letter.includes(ATTRIBUTION_LINE))
  assert.match(roadmap, /# Revision Roadmap \(advisory, non-ranking\)/)
  assert.match(roadmap, /## critical \(1\)/)
  assert.ok(roadmap.includes(ATTRIBUTION_LINE))

  // Human checkpoint 2: approval is refused while the DA CRITICAL is open.
  await rejectsCode(store.approveReport(created.review_id), 'da_adjudication_required')

  const adjudicated = await store.synthesize(created.review_id, [
    { finding_id: 'da-F1', outcome: 'validated', rationale: 'The claim statement is indeed unidentifiable from section 3.' },
  ])
  assert.equal(adjudicated.state.synthesis.da_critical_adjudications[0].outcome, 'validated')
  const approved = await store.approveReport(created.review_id)
  assert.equal(approved.status, 'report_ready')
  assert.notEqual(approved.checkpoints.report_approved_at, null)

  // Per-seat artifacts exist for every seat, in both shapes.
  for (const seatId of ['eic', 'methodology', 'domain', 'perspective', 'da']) {
    const json = JSON.parse(await readFile(join(store.directoryOf(created.review_id), 'seats', seatId + '.json'), 'utf8'))
    assert.equal(json.seat_id, seatId)
    assert.equal(json.review_id, created.review_id)
    assert.equal(json.schema_version, '1')
    assert.ok(Array.isArray(json.findings))
    assert.ok(json.findings.length >= 1)
    assert.ok(typeof json.confidence === 'number')
    assert.match(json.created_at, /^\d{4}-\d{2}-\d{2}T/)
    const markdown = await readFile(join(store.directoryOf(created.review_id), 'seats', seatId + '.md'), 'utf8')
    assert.match(markdown, /# Review card/)
  }
})

test('quick mode runs a single-seat panel', async t => {
  const workspace = await makeWorkspace('quick')
  t.after(workspace.cleanup)
  const store = new ReviewStore({ workspace: workspace.root })

  const created = await store.create({ paperPath: workspace.paper, mode: 'quick' })
  assert.deepEqual(created.panel.seats.map(seat => seat.seat_id), ['eic'])

  // Cards for seats outside this panel are refused rather than ignored.
  await rejectsCode(store.attachFieldAnalysis(created.review_id, fieldAnalysis()), 'invalid_state')

  const cards = fieldAnalysis().configuration_cards.filter(card => card.seat === 'eic')
  await store.attachFieldAnalysis(created.review_id, fieldAnalysis({ configuration_cards: cards }))
  await store.confirmPanel(created.review_id)
  await store.submit(created.review_id, 'eic', seatReport({ verdict: 'accept' }))

  const status = await store.status(created.review_id)
  assert.equal(status.status, 'all_submitted')
  assert.deepEqual(status.submitted_seats, ['eic'])

  const synthesis = await store.synthesize(created.review_id)
  assert.equal(synthesis.state.synthesis.decision, 'accept')
  const approved = await store.approveReport(created.review_id)
  assert.equal(approved.status, 'report_ready')
})

test('a manuscript edited mid-review fails with paper_changed', async t => {
  const workspace = await makeWorkspace('drift')
  t.after(workspace.cleanup)
  const store = new ReviewStore({ workspace: workspace.root })
  const created = await store.create({ paperPath: workspace.paper })
  await store.attachFieldAnalysis(created.review_id, fieldAnalysis())

  await writeFile(workspace.paper, 'rewritten manuscript\n', 'utf8')

  await rejectsCode(store.status(created.review_id), 'paper_changed')
  await rejectsCode(store.submit(created.review_id, 'eic', seatReport()), 'paper_changed')
})

test('unsupported manuscript formats are rejected at create', async t => {
  const workspace = await makeWorkspace('format')
  t.after(workspace.cleanup)
  const store = new ReviewStore({ workspace: workspace.root })

  await rejectsCode(store.create({ paperPath: join(workspace.root, 'paper.pdf') }), 'unsupported_format')
  await rejectsCode(store.create({ paperPath: join(workspace.root, 'paper.docx') }), 'unsupported_format')
  await rejectsCode(store.create({ paperPath: workspace.paper, mode: 'calibration' }), 'invalid_mode')

  // The PDF refusal has to send the caller somewhere useful, not just fail.
  await assert.rejects(
    store.create({ paperPath: join(workspace.root, 'paper.pdf') }),
    /PDF manuscripts are not supported[\s\S]*\.md, \.tex, or \.txt/,
  )
})

test('an oversized manuscript raises a warning instead of being truncated', async t => {
  const workspace = await makeWorkspace('oversize')
  t.after(workspace.cleanup)
  const store = new ReviewStore({ workspace: workspace.root, maxPaperBytes: 16 })
  const created = await store.create({ paperPath: workspace.paper })
  assert.equal(created.warnings.length, 1)
  assert.match(created.warnings[0], /above the 16-byte seat-context budget/)
})

test('synthesis refuses to run while seats are open', async t => {
  const workspace = await makeWorkspace('incomplete')
  t.after(workspace.cleanup)
  const store = new ReviewStore({ workspace: workspace.root })
  const created = await store.create({ paperPath: workspace.paper })
  await rejectsCode(store.synthesize(created.review_id), 'seats_incomplete')
})

test('unknown review ids fail with review_not_found', async t => {
  const workspace = await makeWorkspace('missing')
  t.after(workspace.cleanup)
  const store = new ReviewStore({ workspace: workspace.root })
  await rejectsCode(store.status('rev-20260101-deadbeef'), 'review_not_found')
})
