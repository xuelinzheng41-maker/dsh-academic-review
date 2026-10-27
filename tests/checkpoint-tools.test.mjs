/**
 * Checkpoint tool-surface tests: the shipped five tools must carry a review from
 * 'created' to a delivered report without anyone touching ReviewStore directly.
 * Before academic_review_confirm existed, a live chat session stalled at
 * 'created' (finding from T4).
 */
import assert from 'node:assert/strict'
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import test from 'node:test'
import {
  callTool,
  expectFailure,
  fieldAnalysis,
  finding,
  makeWorkspace,
  mountReviewPlugin,
  rendered,
  seatReport,
} from './helpers.mjs'

/** ISO-8601 timestamp with an explicit offset, as written by the plugin. */
const ISO_WITH_OFFSET = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[+-]\d{2}:\d{2}$/

/** Read one review record straight from disk. */
async function readState(space, reviewId) {
  return JSON.parse(await readFile(join(space.root, '.academic-review', reviewId, 'state.json'), 'utf8'))
}

/** Create a review through the tool surface and return its value. */
async function openReview(tools, space, mode) {
  const created = await callTool(
    tools,
    'academic_review_create',
    mode === undefined ? { paper_path: space.paper } : { paper_path: space.paper, mode },
  )
  assert.equal(created.isError, false, rendered(created))
  return created.value
}

/** Build an action=attach call from the shared field-analysis fixture. */
function attachArgs(reviewId, cards) {
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
    configuration_cards: cards === undefined ? analysis.configuration_cards : cards,
  }
}

test('action=attach stores the field analysis and waits for the human checkpoint', async t => {
  const space = await makeWorkspace('confirm-attach')
  t.after(space.cleanup)
  const { tools } = await mountReviewPlugin({ stateDir: '.academic-review', workspaceRoot: space.root })
  const review = await openReview(tools, space)
  assert.equal(review.status, 'created')

  const attached = await callTool(tools, 'academic_review_confirm', attachArgs(review.review_id))
  assert.equal(attached.isError, false, rendered(attached))
  assert.equal(attached.value.action, 'attach')
  assert.equal(attached.value.status, 'awaiting_panel_confirmation')
  assert.equal(attached.value.field_analysis_attached, true)
  assert.equal(attached.value.pending_checkpoint, 'panel_confirmation')

  const state = await readState(space, review.review_id)
  assert.equal(state.status, 'awaiting_panel_confirmation')
  assert.match(state.field_analysis.analyst_run_at, ISO_WITH_OFFSET)
  assert.equal(state.field_analysis.primary_discipline, fieldAnalysis().primary_discipline)
  assert.equal(state.field_analysis.configuration_cards.length, 4)
  assert.equal(state.checkpoints.panel_confirmed_at, null)

  const status = await callTool(tools, 'academic_review_status', { review_id: review.review_id })
  assert.equal(status.value.status, 'awaiting_panel_confirmation')
  assert.equal(status.value.pending_checkpoint, 'panel_confirmation')
})

test('action=confirm records checkpoint 1 and moves the review to in_review', async t => {
  const space = await makeWorkspace('confirm-run')
  t.after(space.cleanup)
  const { tools } = await mountReviewPlugin({ stateDir: '.academic-review', workspaceRoot: space.root })
  const review = await openReview(tools, space)
  await callTool(tools, 'academic_review_confirm', attachArgs(review.review_id))

  const confirmed = await callTool(tools, 'academic_review_confirm', { review_id: review.review_id, action: 'confirm' })
  assert.equal(confirmed.isError, false, rendered(confirmed))
  assert.equal(confirmed.value.status, 'in_review')
  assert.match(confirmed.value.panel_confirmed_at, ISO_WITH_OFFSET)
  assert.equal(confirmed.value.field_analysis_attached, true)
  assert.equal(confirmed.value.pending_checkpoint, undefined)

  const state = await readState(space, review.review_id)
  assert.equal(state.status, 'in_review')
  assert.equal(state.checkpoints.panel_confirmed_at, confirmed.value.panel_confirmed_at)
  assert.deepEqual(state.panel.seats.map(seat => seat.status), ['dispatched', 'dispatched', 'dispatched', 'dispatched', 'dispatched'])
})

test('action=confirm is refused when no field analysis is attached', async t => {
  const space = await makeWorkspace('confirm-noattach')
  t.after(space.cleanup)
  const { tools } = await mountReviewPlugin({ stateDir: '.academic-review', workspaceRoot: space.root })
  const review = await openReview(tools, space)

  const refused = await callTool(tools, 'academic_review_confirm', { review_id: review.review_id, action: 'confirm' })
  expectFailure(refused, /state_conflict/)
  const state = await readState(space, review.review_id)
  assert.equal(state.status, 'created')
  assert.equal(state.checkpoints.panel_confirmed_at, null)
})

test('submit is still refused until confirm has run', async t => {
  const space = await makeWorkspace('confirm-gate')
  t.after(space.cleanup)
  const { tools } = await mountReviewPlugin({ stateDir: '.academic-review', workspaceRoot: space.root })
  const review = await openReview(tools, space)
  await callTool(tools, 'academic_review_confirm', attachArgs(review.review_id))

  const refused = await callTool(tools, 'academic_review_submit', {
    review_id: review.review_id,
    seat_id: 'eic',
    report: seatReport(),
  })
  expectFailure(refused, /panel_not_confirmed/)

  // Nothing auto-confirms on the failed submit path either.
  const state = await readState(space, review.review_id)
  assert.equal(state.status, 'awaiting_panel_confirmation')
  assert.equal(state.checkpoints.panel_confirmed_at, null)
  assert.equal(state.panel.seats[0].status, 'pending')
})

test('a full review runs create -> attach -> confirm -> five submits using only tools', async t => {
  const space = await makeWorkspace('confirm-full')
  t.after(space.cleanup)
  const { tools } = await mountReviewPlugin({ stateDir: '.academic-review', workspaceRoot: space.root })

  const review = await openReview(tools, space, 'full')
  assert.equal(review.seats.length, 5)

  const attached = await callTool(tools, 'academic_review_confirm', attachArgs(review.review_id))
  assert.equal(attached.value.status, 'awaiting_panel_confirmation')

  const confirmed = await callTool(tools, 'academic_review_confirm', { review_id: review.review_id, action: 'confirm' })
  assert.equal(confirmed.value.status, 'in_review')

  const seats = [
    ['eic', 'accept', [finding('eic-F1', { severity: 'minor' })]],
    ['methodology', 'minor_revision', [finding('methodology-F1')]],
    ['domain', 'major_revision', [finding('domain-F1', { severity: 'critical' })]],
    ['perspective', 'minor_revision', [finding('perspective-F1', { severity: 'minor' })]],
    ['da', 'major_revision', [finding('da-F1', { severity: 'critical', title: 'Central claim is not identified' })]],
  ]
  let last
  for (const [seatId, verdict, findings] of seats) {
    last = await callTool(tools, 'academic_review_submit', {
      review_id: review.review_id,
      seat_id: seatId,
      report: seatReport({ verdict, findings }),
    })
    assert.equal(last.isError, false, rendered(last))
    assert.equal(last.value.seat_id, seatId)
  }
  assert.equal(last.value.status, 'all_submitted')
  assert.deepEqual(last.value.missing_seats, [])

  const status = await callTool(tools, 'academic_review_status', { review_id: review.review_id })
  assert.equal(status.value.status, 'all_submitted')
  assert.deepEqual(status.value.submitted_seats, ['eic', 'methodology', 'domain', 'perspective', 'da'])
  assert.equal(status.value.pending_checkpoint, undefined)

  // Phase 2 and human checkpoint 2, still tools only.
  const draft = await callTool(tools, 'academic_review_report', { review_id: review.review_id })
  assert.equal(draft.isError, false, rendered(draft))
  assert.equal(draft.value.status, 'awaiting_synthesis_approval')
  assert.equal(draft.value.approved, false)
  // Two minor and two major verdicts tie; the documented tie-break is the more severe one.
  assert.equal(draft.value.decision, 'major_revision')

  // Approval cannot silently swallow the DA CRITICAL finding.
  const blocked = await callTool(tools, 'academic_review_report', { review_id: review.review_id, approve: true })
  expectFailure(blocked, /da_adjudication_required/)

  const approved = await callTool(tools, 'academic_review_report', {
    review_id: review.review_id,
    approve: true,
    da_adjudications: [
      { finding_id: 'da-F1', outcome: 'validated', rationale: 'Section 3 states the claim only in the abstract.' },
    ],
  })
  assert.equal(approved.isError, false, rendered(approved))
  assert.equal(approved.value.status, 'report_ready')
  assert.equal(approved.value.approved, true)

  const letter = await readFile(join(space.root, '.academic-review', review.review_id, 'editorial_decision.md'), 'utf8')
  assert.match(letter, /# Editorial Decision Letter/)
})

test('both actions refuse an unknown review id', async t => {
  const space = await makeWorkspace('confirm-unknown')
  t.after(space.cleanup)
  const { tools } = await mountReviewPlugin({ stateDir: '.academic-review', workspaceRoot: space.root })

  expectFailure(
    await callTool(tools, 'academic_review_confirm', attachArgs('rev-20260101-deadbeef')),
    /review_not_found/,
  )
  expectFailure(
    await callTool(tools, 'academic_review_confirm', { review_id: 'rev-20260101-deadbeef', action: 'confirm' }),
    /review_not_found/,
  )
})

test('a manuscript edited after attach blocks confirm with paper_changed', async t => {
  const space = await makeWorkspace('confirm-drift')
  t.after(space.cleanup)
  const { tools } = await mountReviewPlugin({ stateDir: '.academic-review', workspaceRoot: space.root })
  const review = await openReview(tools, space)
  await callTool(tools, 'academic_review_confirm', attachArgs(review.review_id))

  await writeFile(space.paper, '# rewritten\n', 'utf8')
  expectFailure(
    await callTool(tools, 'academic_review_confirm', { review_id: review.review_id, action: 'confirm' }),
    /paper_changed/,
  )
})

test('attach validates its payload and refuses a second attach', async t => {
  const space = await makeWorkspace('confirm-payload')
  t.after(space.cleanup)
  const { tools } = await mountReviewPlugin({ stateDir: '.academic-review', workspaceRoot: space.root })
  const review = await openReview(tools, space)

  const missingField = attachArgs(review.review_id)
  delete missingField.primary_discipline
  expectFailure(await callTool(tools, 'academic_review_confirm', missingField), /primary_discipline/)

  const noCards = attachArgs(review.review_id)
  delete noCards.configuration_cards
  expectFailure(await callTool(tools, 'academic_review_confirm', noCards), /configuration_cards/)

  const wrongCardCount = attachArgs(review.review_id, fieldAnalysis().configuration_cards.slice(0, 2))
  expectFailure(await callTool(tools, 'academic_review_confirm', wrongCardCount), /configuration_cards/)

  const first = await callTool(tools, 'academic_review_confirm', attachArgs(review.review_id))
  assert.equal(first.isError, false, rendered(first))
  expectFailure(await callTool(tools, 'academic_review_confirm', attachArgs(review.review_id)), /state_conflict/)
})

test('reduced panels attach only the cards that exist for them', async t => {
  const space = await makeWorkspace('confirm-quick')
  t.after(space.cleanup)
  const { tools } = await mountReviewPlugin({ stateDir: '.academic-review', workspaceRoot: space.root })
  const review = await openReview(tools, space, 'quick')
  assert.deepEqual(review.seats.map(seat => seat.seat_id), ['eic'])

  const cards = fieldAnalysis().configuration_cards.filter(card => card.seat === 'eic')
  const attached = await callTool(tools, 'academic_review_confirm', attachArgs(review.review_id, cards))
  assert.equal(attached.isError, false, rendered(attached))
  const confirmed = await callTool(tools, 'academic_review_confirm', { review_id: review.review_id, action: 'confirm' })
  assert.equal(confirmed.value.status, 'in_review')

  const submitted = await callTool(tools, 'academic_review_submit', {
    review_id: review.review_id,
    seat_id: 'eic',
    report: seatReport({ verdict: 'accept' }),
  })
  assert.equal(submitted.value.status, 'all_submitted')
})
