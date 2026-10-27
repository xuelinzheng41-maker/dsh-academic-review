/**
 * Web-surface tests: the three read-only review routes summarize state.json
 * correctly, refuse mutations and traversal, 404 unknown ids, and 409 a
 * missing report. Run against the compiled lib like the other suites.
 */
import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { Context } from '@deepseek-ai/cordis'
import { ReviewStore } from '../lib/state.js'
import { registerAcademicReviewWebRoutes, REVIEWS_ROUTE_ROOT, summarizeReview } from '../lib/web.js'
import { fieldAnalysis, finding, makeWorkspace, seatReport } from './helpers.mjs'
import { prefixMatches, resolveRoute } from './host-prefix-matcher.mjs'

/** Mount the routes on a throwaway context with an in-memory web server. */
function mountWeb(workspaceRoot) {
  const ctx = new Context()
  const routes = new Map()
  ctx.provide('webServer', {
    register(route) {
      routes.set(route.kind + ' ' + route.path, route)
      return () => routes.delete(route.kind + ' ' + route.path)
    },
  })
  ctx.provide('connection', { requestRejection: () => undefined })
  registerAcademicReviewWebRoutes(ctx, { stateDir: '.academic-review', workspaceRoot })
  return routes
}

/** Invoke a registered handler with a fake req/res and capture the response. */
async function call(route, url, method = 'GET') {
  let status
  let body = ''
  const res = {
    writeHead(code, headers) { status = code; return res },
    end(chunk) { body = chunk === undefined ? '' : String(chunk) },
  }
  await route.handler({ method, url: url.startsWith('/') ? url : url.replace(/^https?:\/\/[^/]+/, '') }, res)
  return { status, body, json: () => JSON.parse(body) }
}

test('the reviews list route summarizes state.json records', async t => {
  const space = await makeWorkspace('web-list')
  t.after(space.cleanup)
  const store = new ReviewStore({ workspace: space.root })
  const created = await store.create({ paperPath: space.paper })
  await store.attachFieldAnalysis(created.review_id, fieldAnalysis())

  const routes = mountWeb(space.root)
  const list = routes.get('exact ' + REVIEWS_ROUTE_ROOT)
  assert.ok(list, 'exact list route registered')
  const response = await call(list, REVIEWS_ROUTE_ROOT)
  assert.equal(response.status, 200)
  const body = response.json()
  assert.equal(body.reviews.length, 1)
  const review = body.reviews[0]
  assert.equal(review.review_id, created.review_id)
  assert.equal(review.paper_name, 'manuscript.md')
  assert.equal(review.mode, 'full')
  assert.equal(review.status, 'awaiting_panel_confirmation')
  assert.equal(review.pending_checkpoint, true)
  assert.deepEqual(review.seats.map(seat => seat.seat_id), ['eic', 'methodology', 'domain', 'perspective', 'da'])
  assert.ok(review.seats.every(seat => seat.status === 'pending' && seat.findings_open === 0))
})

test('full lifecycle surfaces findings tallies and clears the checkpoint', async t => {
  const space = await makeWorkspace('web-full')
  t.after(space.cleanup)
  const store = new ReviewStore({ workspace: space.root })
  const created = await store.create({ paperPath: space.paper })
  await store.attachFieldAnalysis(created.review_id, fieldAnalysis())
  await store.confirmPanel(created.review_id)
  for (const [seatId, verdict] of [['eic', 'accept'], ['methodology', 'minor_revision'], ['domain', 'major_revision'], ['perspective', 'minor_revision'], ['da', 'reject']]) {
    const findings = seatId === 'da'
      ? [finding('da-F1', { severity: 'critical', title: 'Central claim unidentified' }), finding('da-F2', { severity: 'minor' })]
      : [finding(seatId + '-F1')]
    await store.submit(created.review_id, seatId, seatReport({ verdict, findings }))
  }
  await store.synthesize(created.review_id, [
    { finding_id: 'da-F1', outcome: 'validated', rationale: 'Confirmed from section 3.' },
  ])
  await store.approveReport(created.review_id)

  const routes = mountWeb(space.root)
  const detail = routes.get('prefix ' + REVIEWS_ROUTE_ROOT)
  assert.ok(detail, 'prefix detail route registered')
  const one = await call(detail, REVIEWS_ROUTE_ROOT + '/' + created.review_id)
  assert.equal(one.status, 200)
  const summary = one.json()
  assert.equal(summary.status, 'report_ready')
  assert.equal(summary.pending_checkpoint, false)
  const da = summary.seats.find(seat => seat.seat_id === 'da')
  assert.equal(da.findings_open, 2)
  assert.equal(da.findings_by_severity.critical, 1)
  assert.equal(da.findings_by_severity.minor, 1)

  const report = await call(detail, REVIEWS_ROUTE_ROOT + '/' + created.review_id + '/report')
  assert.equal(report.status, 200)
  assert.match(report.json().markdown, /# Editorial Decision Letter/)

  // Report 409 before synthesis has written the letter.
  const early = await makeWorkspace('web-early')
  t.after(early.cleanup)
  const earlyStore = new ReviewStore({ workspace: early.root })
  const earlyReview = await earlyStore.create({ paperPath: early.paper })
  const earlyRoutes = mountWeb(early.root)
  const earlyDetail = earlyRoutes.get('prefix ' + REVIEWS_ROUTE_ROOT)
  const earlyReport = await call(earlyDetail, REVIEWS_ROUTE_ROOT + '/' + earlyReview.review_id + '/report')
  assert.equal(earlyReport.status, 409)
  assert.equal(earlyReport.json().error, 'report_not_ready')
})

test('unknown ids, traversal, mutations, and bad auth are refused', async t => {
  const space = await makeWorkspace('web-guard')
  t.after(space.cleanup)
  await new ReviewStore({ workspace: space.root }).create({ paperPath: space.paper })
  const routes = mountWeb(space.root)
  const detail = routes.get('prefix ' + REVIEWS_ROUTE_ROOT)

  const missing = await call(detail, REVIEWS_ROUTE_ROOT + '/rev-20260101-00000000')
  assert.equal(missing.status, 404)

  // Traversal-shaped ids never match the review-id pattern.
  for (const evil of ['..%2F..%2Fevil', 'rev-20260101-00000000/../../etc', 'not-an-id']) {
    const response = await call(detail, REVIEWS_ROUTE_ROOT + '/' + evil)
    assert.equal(response.status, 404, evil)
  }

  // Prefix route also refuses a report request carrying a traversal tail.
  const traversalTail = await call(detail, REVIEWS_ROUTE_ROOT + '/rev-20260101-00000000/report/../../../state.json')
  assert.equal(traversalTail.status, 404)

  // Read-only: POST is 405 on both routes.
  assert.equal((await call(detail, REVIEWS_ROUTE_ROOT, 'POST')).status, 405)
  const list = routes.get('exact ' + REVIEWS_ROUTE_ROOT)
  assert.equal((await call(list, REVIEWS_ROUTE_ROOT, 'POST')).status, 405)

  // Unauthenticated requests are refused before any handler reads state.
  const ctx = new Context()
  const guarded = new Map()
  ctx.provide('webServer', { register(route) { guarded.set(route.kind + ' ' + route.path, route); return () => {} } })
  ctx.provide('connection', { requestRejection: () => 401 })
  registerAcademicReviewWebRoutes(ctx, { stateDir: '.academic-review', workspaceRoot: space.root })
  const gated = guarded.get('exact ' + REVIEWS_ROUTE_ROOT)
  let status
  const res = { writeHead(code) { status = code; return res }, end() {} }
  await gated.handler({ method: 'GET', url: REVIEWS_ROUTE_ROOT }, res)
  assert.equal(status, 401)
})

test('summarizeReview keeps the editorial synthesizer out of the seat list', async t => {
  const space = await makeWorkspace('web-summary')
  t.after(space.cleanup)
  const store = new ReviewStore({ workspace: space.root })
  const created = await store.create({ paperPath: space.paper })
  const summary = summarizeReview(await store.read(created.review_id))
  assert.deepEqual(summary.seats.map(seat => seat.seat_id), ['eic', 'methodology', 'domain', 'perspective', 'da'])
})

test('regression (t7): detail paths match the real host prefix semantics', async t => {
  const space = await makeWorkspace('web-prefix')
  t.after(space.cleanup)
  const store = new ReviewStore({ workspace: space.root })
  const created = await store.create({ paperPath: space.paper })
  await store.attachFieldAnalysis(created.review_id, fieldAnalysis())
  await store.confirmPanel(created.review_id)
  for (const [seatId, verdict] of [['eic', 'accept'], ['methodology', 'minor_revision'], ['domain', 'major_revision'], ['perspective', 'minor_revision'], ['da', 'reject']]) {
    await store.submit(created.review_id, seatId, seatReport({ verdict, findings: [finding(seatId + '-F1')] }))
  }
  await store.synthesize(created.review_id, [
    { finding_id: 'da-F1', outcome: 'validated', rationale: 'Confirmed.' },
  ])
  await store.approveReport(created.review_id)

  // Registrar that records routes verbatim (no normalization, unlike the old fake).
  const registered = []
  const ctx = new Context()
  ctx.provide('webServer', { register(route) { registered.push(route); return () => {} } })
  ctx.provide('connection', { requestRejection: () => undefined })
  registerAcademicReviewWebRoutes(ctx, { stateDir: '.academic-review', workspaceRoot: space.root })

  // No registered prefix may end with '/' — the t7 defect.
  for (const route of registered) {
    assert.ok(!route.path.endsWith('/'), 'prefix must not end with a slash: ' + route.path)
  }

  const list = resolveRoute(registered, REVIEWS_ROUTE_ROOT)
  assert.ok(list, 'list route still matches ' + REVIEWS_ROUTE_ROOT)
  const detail = resolveRoute(registered, REVIEWS_ROUTE_ROOT + '/' + created.review_id)
  assert.ok(detail, 'detail path must match the prefix route (t7 regression)')
  const report = resolveRoute(registered, REVIEWS_ROUTE_ROOT + '/' + created.review_id + '/report')
  assert.ok(report, 'report path must match the prefix route (t7 regression)')
  // '/reviewsX' is not under the prefix and the exact route is a different path.
  assert.equal(resolveRoute(registered, REVIEWS_ROUTE_ROOT + 'X'), null, 'reviewsX must not match')
  // End-to-end through the matcher: detail and report actually respond 200.
  const one = await call(detail, REVIEWS_ROUTE_ROOT + '/' + created.review_id)
  assert.equal(one.status, 200)
  const letter = await call(report, REVIEWS_ROUTE_ROOT + '/' + created.review_id + '/report')
  assert.equal(letter.status, 200)
  assert.match(letter.json().markdown, /# Editorial Decision Letter/)
  // Bare prefix dispatched to the prefix handler yields a clean 404, not a crash.
  const bare = await call(detail, REVIEWS_ROUTE_ROOT)
  assert.equal(bare.status, 404)
  // Trailing slash on a detail path is tolerated.
  const slashed = await call(detail, REVIEWS_ROUTE_ROOT + '/' + created.review_id + '/')
  assert.equal(slashed.status, 200)
})
