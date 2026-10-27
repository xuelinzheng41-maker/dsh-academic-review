/**
 * DOM verification: render AcademicReviewPanel under happy-dom against the
 * real web-route contract (a local fetch shim backed by actual state.json
 * produced by ReviewStore) and assert the panel content.
 */
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { Window } from 'happy-dom'
import { register } from 'node:module'

/** Resolve .module.css imports to an empty Record for the headless DOM run. */
register('./css-stub-loader.mjs', import.meta.url)
import { ReviewStore } from '../lib/state.js'
import { summarizeReview, REVIEWS_ROUTE_ROOT } from '../lib/web.js'
import { fieldAnalysis, finding, makeWorkspace, seatReport } from './helpers.mjs'

test('the panel renders a real review: seats, tallies, checkpoint, report action', async t => {
  const space = await makeWorkspace('dom')
  t.after(space.cleanup)
  const store = new ReviewStore({ workspace: space.root })
  const created = await store.create({ paperPath: space.paper })
  await store.attachFieldAnalysis(created.review_id, fieldAnalysis())
  await store.confirmPanel(created.review_id)
  for (const [seatId, verdict] of [['eic', 'accept'], ['methodology', 'minor_revision'], ['domain', 'major_revision'], ['perspective', 'minor_revision'], ['da', 'reject']]) {
    const findings = seatId === 'da'
      ? [finding('da-F1', { severity: 'critical', title: 'Central claim unidentified' })]
      : [finding(seatId + '-F1')]
    await store.submit(created.review_id, seatId, seatReport({ verdict, findings }))
  }
  await store.synthesize(created.review_id)
  const state = await store.read(created.review_id)
  const summary = summarizeReview(state)

  // Browser environment.
  const window = new Window({ url: 'http://localhost/' })
  globalThis.window = window
  globalThis.document = window.document
  Object.defineProperty(globalThis, 'navigator', { value: window.navigator, configurable: true })
  globalThis.fetch = async () => ({
    ok: true,
    status: 200,
    json: async () => ({ reviews: [summary] }),
  })
  globalThis.Blob = class { constructor(parts) { this.text = parts.join('') } }
  globalThis.URL.createObjectURL = () => 'blob:mock'
  globalThis.URL.revokeObjectURL = () => {}
  window.Date = Date

  const react = await import('react')
  const { act } = await import('react-dom/test-utils')
  const { createRoot } = await import('react-dom/client')
  const { AcademicReviewPanel } = await import('../lib/client/AcademicReviewPanel.js')

  const zh = (await import('../lib/client/locales.js')).zh
  const t_fn = key => zh[key] ?? key
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  await act(async () => { root.render(react.createElement(AcademicReviewPanel, { t: t_fn })) })
  // Effects run the fetch; flush one poll cycle.
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 30)) })

  const panel = document.querySelector('[data-testid="academic-review-panel"]')
  assert.ok(panel, 'panel mounts')
  assert.match(panel.textContent, /学术评审/)
  assert.match(panel.textContent, new RegExp(created.review_id))
  assert.match(panel.textContent, /评审席位/)
  for (const seatName of ['主编（Journal-Fit）', '方法论审稿人 1', '领域审稿人 2', '视角审稿人 3', '魔鬼代言人', '编辑部综合']) {
    assert.match(panel.textContent, new RegExp(seatName), seatName)
  }
  // Per-seat statuses render as chips with data attributes.
  const daRow = document.querySelector('[data-seat="da"]')
  assert.ok(daRow, 'DA row present')
  assert.equal(daRow.getAttribute('data-status'), 'submitted')
  assert.match(daRow.textContent, /严重 1/)
  // Checkpoint indicator.
  assert.match(panel.textContent, /等待人工确认/)
  // Report action hidden while not approved.
  assert.match(panel.textContent, /报告尚未生成/)
  root.unmount()
})

test('the panel shows the empty state when no reviews exist', async t => {
  const window = new Window({ url: 'http://localhost/' })
  globalThis.window = window
  globalThis.document = window.document
  Object.defineProperty(globalThis, 'navigator', { value: window.navigator, configurable: true })
  globalThis.fetch = async () => ({ ok: true, status: 200, json: async () => ({ reviews: [] }) })

  const react = await import('react')
  const { act } = await import('react-dom/test-utils')
  const { createRoot } = await import('react-dom/client')
  const { AcademicReviewPanel } = await import('../lib/client/AcademicReviewPanel.js')
  const zh = (await import('../lib/client/locales.js')).zh
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  await act(async () => { root.render(react.createElement(AcademicReviewPanel, { t: key => zh[key] ?? key })) })
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 20)) })
  const empty = document.querySelector('[data-state="empty"]')
  assert.ok(empty, 'empty state renders')
  assert.match(empty.textContent, /当前工作区还没有评审/)
  root.unmount()
})
