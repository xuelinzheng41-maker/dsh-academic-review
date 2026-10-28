/**
 * DOM verification: render AcademicReviewPanel under happy-dom against the
 * real web-route contract (a local fetch shim backed by actual state.json
 * produced by ReviewStore) and assert the panel content.
 *
 * Coverage: seat table and tallies; the pending-checkpoint card for every
 * checkpoint the state machine can report (field_analysis_attachment,
 * panel_confirmation, report_approval) including the exact call text and its
 * copy button; the rendered editorial decision letter (headings, lists,
 * paragraphs, tables) with model output never injected as HTML; and the empty
 * state.
 */
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import test from 'node:test'
import { Window } from 'happy-dom'
import { register } from 'node:module'

/** Resolve .module.css imports to an empty Record for the headless DOM run. */
register('./css-stub-loader.mjs', import.meta.url)
import { ReviewStore } from '../lib/state.js'
import { summarizeReview } from '../lib/web.js'
import { fieldAnalysis, finding, makeWorkspace, seatReport } from './helpers.mjs'

/** Five committed seat cards, one DA CRITICAL finding among them. */
const SEAT_VERDICTS = [['eic', 'accept'], ['methodology', 'minor_revision'], ['domain', 'major_revision'], ['perspective', 'minor_revision'], ['da', 'reject']]

/** Submit all five seats on one review. */
async function submitEverySeat(store, reviewId) {
  for (const [seatId, verdict] of SEAT_VERDICTS) {
    const findings = seatId === 'da'
      ? [finding('da-F1', { severity: 'critical', title: 'Central claim unidentified' })]
      : [finding(seatId + '-F1')]
    await store.submit(reviewId, seatId, seatReport({ verdict, findings }))
  }
}

/** Read the decision letter the synthesizer wrote to disk. */
async function letterOf(store, reviewId) {
  const state = await store.read(reviewId)
  const directory = store.directoryOf(reviewId)
  return readFile(join(directory, state.synthesis.decision_letter_path), 'utf8')
}

/**
 * Mount the panel over a fetch shim that answers the plugin's read-only routes
 * from real store summaries. Every request is recorded so the tests can prove
 * the panel only ever issues GETs.
 * @param options - reviews list, optional report markdown, clipboard sink.
 */
async function mountPanel({ reviews, report = null, clipboard = null }) {
  const window = new Window({ url: 'http://localhost/' })
  globalThis.window = window
  globalThis.document = window.document
  Object.defineProperty(globalThis, 'navigator', { value: window.navigator, configurable: true })
  if (clipboard !== null) {
    Object.defineProperty(window.navigator, 'clipboard', {
      value: { writeText: async value => { clipboard.push(value) } },
      configurable: true,
    })
  }
  const requests = []
  globalThis.fetch = async (input, init) => {
    const url = typeof input === 'string' ? input : String(input)
    requests.push({ url, method: init?.method ?? 'GET' })
    if (url.endsWith('/report')) {
      if (report === null) return { ok: false, status: 409, json: async () => ({ error: 'report_not_ready' }) }
      return { ok: true, status: 200, json: async () => ({ markdown: report }) }
    }
    return { ok: true, status: 200, json: async () => ({ reviews }) }
  }
  globalThis.Blob = class { constructor(parts) { this.text = parts.join('') } }
  globalThis.URL.createObjectURL = () => 'blob:mock'
  globalThis.URL.revokeObjectURL = () => {}
  window.Date = Date

  const react = await import('react')
  const { act } = await import('react-dom/test-utils')
  const { createRoot } = await import('react-dom/client')
  const { AcademicReviewPanel } = await import('../lib/client/AcademicReviewPanel.js')
  const zh = (await import('../lib/client/locales.js')).zh

  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  await act(async () => { root.render(react.createElement(AcademicReviewPanel, { t: key => zh[key] ?? key })) })
  // Effects run the fetch; flush one poll cycle (and the report fetch).
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 30)) })
  return {
    panel: document.querySelector('[data-testid="academic-review-panel"]'),
    requests,
    window,
    click: async element => { await act(async () => { element.click() }) },
    unmount: async () => {
      await act(async () => { root.unmount() })
      container.remove()
    },
  }
}

/** Assert the panel's every request was a plain GET against the reviews root. */
function assertReadOnly(requests) {
  assert.ok(requests.length > 0, 'the panel fetched something')
  for (const request of requests) {
    assert.equal(request.method, 'GET', 'panel request must be GET: ' + request.url)
    assert.ok(request.url.startsWith('/plugins/dsh-academic-skills/reviews'), 'unexpected URL: ' + request.url)
  }
}

test('the panel renders a real review: seats, tallies, checkpoint, report action', async t => {
  const space = await makeWorkspace('dom')
  t.after(space.cleanup)
  const store = new ReviewStore({ workspace: space.root })
  const created = await store.create({ paperPath: space.paper })
  await store.attachFieldAnalysis(created.review_id, fieldAnalysis())
  await store.confirmPanel(created.review_id)
  await submitEverySeat(store, created.review_id)
  await store.synthesize(created.review_id)
  const summary = summarizeReview(await store.read(created.review_id))

  const mounted = await mountPanel({ reviews: [summary] })
  t.after(mounted.unmount)
  const panel = mounted.panel
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
  // Checkpoint badge.
  assert.match(panel.textContent, /等待人工确认/)
  // Report action hidden while not approved.
  assert.match(panel.textContent, /报告尚未生成/)
  assertReadOnly(mounted.requests)
})

test('the panel shows the checkpoint-1 card with the exact attach+confirm calls', async t => {
  const space = await makeWorkspace('dom-attach')
  t.after(space.cleanup)
  const store = new ReviewStore({ workspace: space.root })
  const created = await store.create({ paperPath: space.paper })
  const summary = summarizeReview(await store.read(created.review_id))
  assert.equal(summary.status, 'created')
  // The route serves a boolean today; the card must still name the checkpoint.
  assert.equal(summary.pending_checkpoint, false)

  const clipboard = []
  const mounted = await mountPanel({ reviews: [summary], clipboard })
  t.after(mounted.unmount)

  const card = document.querySelector('[data-testid="checkpoint-card"]')
  assert.ok(card, 'checkpoint card renders at created')
  assert.equal(card.getAttribute('data-checkpoint'), 'field_analysis_attachment')
  assert.match(card.textContent, /确认点 1 · 附上领域分析/)

  const call = document.querySelector('[data-testid="next-call"]').textContent
  assert.match(call, /academic_review_confirm\(\{/)
  assert.ok(call.includes('action: "attach"'), 'attach action named: ' + call)
  assert.ok(call.includes('action: "confirm"'), 'confirm action named: ' + call)
  assert.ok(call.includes(created.review_id), 'call names the review id')
  for (const field of ['primary_discipline', 'secondary_disciplines', 'research_paradigm', 'methodology_type', 'target_journal_tier', 'paper_maturity', 'configuration_cards']) {
    assert.ok(call.includes(field), 'attach payload names ' + field)
  }
  for (const seat of ['eic', 'methodology', 'domain', 'perspective']) {
    assert.ok(call.includes('seat: "' + seat + '"'), 'configuration card for ' + seat)
  }
  assert.ok(!call.includes('seat: "da"'), "the DA seat takes no configuration card")

  // Copy button copies that exact text.
  const copy = document.querySelector('[data-testid="copy-call"]')
  assert.ok(copy, 'copy button renders')
  await mounted.click(copy)
  assert.deepEqual(clipboard, [call], 'clipboard receives the exact call text')
  assert.equal(copy.getAttribute('data-copy-state'), 'copied')
  assert.match(copy.textContent, /已复制/)
  assertReadOnly(mounted.requests)
})

test('the panel shows the panel_confirmation card once the field analysis is attached', async t => {
  const space = await makeWorkspace('dom-confirm')
  t.after(space.cleanup)
  const store = new ReviewStore({ workspace: space.root })
  const created = await store.create({ paperPath: space.paper })
  await store.attachFieldAnalysis(created.review_id, fieldAnalysis())
  const summary = summarizeReview(await store.read(created.review_id))
  assert.equal(summary.status, 'awaiting_panel_confirmation')
  assert.equal(summary.pending_checkpoint, true)

  const clipboard = []
  const mounted = await mountPanel({ reviews: [summary], clipboard })
  t.after(mounted.unmount)

  const card = document.querySelector('[data-testid="checkpoint-card"]')
  assert.equal(card.getAttribute('data-checkpoint'), 'panel_confirmation')
  assert.match(card.textContent, /确认点 1 · 确认评审面板/)
  const call = document.querySelector('[data-testid="next-call"]').textContent
  assert.ok(call.includes('academic_review_confirm('), 'confirm tool named')
  assert.ok(call.includes('action: "confirm"'), 'confirm action named')
  assert.ok(!call.includes('action: "attach"'), 'attach is already done')
  assert.ok(call.includes(created.review_id))
  await mounted.click(document.querySelector('[data-testid="copy-call"]'))
  assert.deepEqual(clipboard, [call])
  assertReadOnly(mounted.requests)
})

test('the panel shows the report_approval card with approve=true and the DA adjudication requirement', async t => {
  const space = await makeWorkspace('dom-approve')
  t.after(space.cleanup)
  const store = new ReviewStore({ workspace: space.root })
  const created = await store.create({ paperPath: space.paper })
  await store.attachFieldAnalysis(created.review_id, fieldAnalysis())
  await store.confirmPanel(created.review_id)
  await submitEverySeat(store, created.review_id)
  await store.synthesize(created.review_id)
  const summary = summarizeReview(await store.read(created.review_id))
  assert.equal(summary.status, 'awaiting_synthesis_approval')

  const clipboard = []
  const mounted = await mountPanel({ reviews: [summary], clipboard })
  t.after(mounted.unmount)

  const card = document.querySelector('[data-testid="checkpoint-card"]')
  assert.equal(card.getAttribute('data-checkpoint'), 'report_approval')
  assert.match(card.textContent, /确认点 2 · 批准评审报告/)
  const call = document.querySelector('[data-testid="next-call"]').textContent
  assert.ok(call.includes('academic_review_report('), 'report tool named')
  assert.ok(call.includes('approve: true'), 'approve=true named')
  assert.ok(call.includes('da_adjudications'), 'DA adjudications named')
  assert.ok(call.includes('validated'), 'outcome enum named')
  assert.ok(call.includes(created.review_id))
  const requirement = document.querySelector('[data-testid="checkpoint-requirement"]')
  assert.ok(requirement, 'adjudication requirement shown')
  assert.match(requirement.textContent, /CRITICAL/)
  assert.match(requirement.textContent, /validated \/ rejected \/ unresolved/)
  await mounted.click(document.querySelector('[data-testid="copy-call"]'))
  assert.deepEqual(clipboard, [call])
  assertReadOnly(mounted.requests)
})

test('a server-declared checkpoint name wins over the status-derived one', async t => {
  const space = await makeWorkspace('dom-name')
  t.after(space.cleanup)
  const store = new ReviewStore({ workspace: space.root })
  const created = await store.create({ paperPath: space.paper })
  await store.attachFieldAnalysis(created.review_id, fieldAnalysis())
  const summary = summarizeReview(await store.read(created.review_id))
  const mounted = await mountPanel({
    reviews: [{ ...summary, pending_checkpoint: 'report_approval' }],
  })
  t.after(mounted.unmount)
  const card = document.querySelector('[data-testid="checkpoint-card"]')
  assert.equal(card.getAttribute('data-checkpoint'), 'report_approval')
  assert.ok(document.querySelector('[data-testid="next-call"]').textContent.includes('academic_review_report('))
})

test('the panel renders the decision letter as React nodes and never injects model HTML', async t => {
  const space = await makeWorkspace('dom-letter')
  t.after(space.cleanup)
  const store = new ReviewStore({ workspace: space.root })
  const created = await store.create({ paperPath: space.paper })
  await store.attachFieldAnalysis(created.review_id, fieldAnalysis())
  await store.confirmPanel(created.review_id)
  await submitEverySeat(store, created.review_id)
  await store.synthesize(created.review_id, [
    { finding_id: 'da-F1', outcome: 'validated', rationale: 'The central claim is never stated, so no evidence can support it.' },
  ])
  await store.approveReport(created.review_id)
  const summary = summarizeReview(await store.read(created.review_id))
  assert.equal(summary.status, 'report_ready')

  // The real letter, plus a hostile tail the renderer must keep as text.
  const served = (await letterOf(store, created.review_id))
    + '\n\n<script>window.__pwned = 1<\/script>\n\n<b>not bold</b>\n'

  const mounted = await mountPanel({ reviews: [summary], report: served })
  t.after(mounted.unmount)

  const letter = document.querySelector('[data-testid="letter-body"]')
  assert.ok(letter, 'letter body renders')
  assert.equal(letter.querySelector('h1').textContent, 'Editorial Decision Letter')
  assert.ok(letter.querySelectorAll('h2').length >= 4, 'section headings render as h2')
  assert.ok(letter.querySelectorAll('h3').length >= 5, 'per-seat headings render as h3')
  assert.ok(letter.querySelectorAll('ul').length >= 1, 'bullet lists render as ul')
  assert.ok(letter.querySelectorAll('li').length >= 5, 'list items render as li')
  assert.ok(letter.querySelectorAll('table').length >= 1, 'the seat-verdict table renders')
  assert.ok(letter.querySelectorAll('th').length >= 5, 'table headers render')
  assert.ok(letter.querySelectorAll('blockquote').length >= 1, 'the role-separation notice renders as a quote')
  assert.ok(letter.querySelectorAll('p').length >= 3, 'paragraphs render as p')
  assert.match(letter.textContent, /Advisory decision: /)
  // Human approval / no self-approval sentence survives as plain text.
  assert.match(letter.textContent, /never approves its own output/)

  // Sanitisation: raw markup stays text and never becomes a live node.
  assert.equal(letter.querySelectorAll('script').length, 0, 'no script element injected')
  assert.equal(document.querySelectorAll('script').length, 0, 'no script element in the document')
  assert.equal(mounted.window.__pwned, undefined, 'injected script never executed')
  assert.ok(letter.textContent.includes('<script>window.__pwned = 1</script>'), 'raw tag preserved as text')
  assert.equal(letter.querySelectorAll('b').length, 0, 'raw <b> tag not turned into an element')
  assert.ok(letter.textContent.includes('<b>not bold</b>'), 'raw <b> tag preserved as text')

  // The report came from the read-only route, once, with GET.
  assert.ok(mounted.requests.some(request => request.url.endsWith('/report')), 'report route fetched')
  assertReadOnly(mounted.requests)
  // The openable report button is offered next to the rendered letter.
  assert.match(mounted.panel.textContent, /打开评审报告/)
  // A closed review is waiting on no human: no checkpoint card.
  assert.equal(document.querySelector('[data-testid="checkpoint-card"]'), null, 'no checkpoint card once report_ready')
  assert.match(mounted.panel.textContent, /报告就绪/)
})

test('the letter renderer keeps intraword underscores literal and never spells HTML', async () => {
  const react = await import('react')
  const { renderToStaticMarkup } = await import('react-dom/server')
  const { renderLetter } = await import('../lib/client/letter-markdown.js')
  const markdown = [
    '## 1. Seat verdicts',
    '',
    '- methodology → minor_revision',
    '- snake_case_finding_id',
    '- _No findings._',
    '',
    'Inline `code` and **bold** and <img src=x onerror=alert(1)> stay inert.',
  ].join('\n')
  const html = renderToStaticMarkup(react.createElement('div', null, renderLetter(markdown)))
  assert.match(html, /minor_revision/, 'intraword underscore stays literal')
  assert.match(html, /snake_case_finding_id/, 'a second intraword underscore stays literal')
  assert.doesNotMatch(html, /<em>revision<\/em>/, 'no accidental emphasis inside a verdict name')
  assert.match(html, /<em>No findings\.<\/em>/, 'delimited underscores still emphasise')
  assert.match(html, /<code>code<\/code>/, 'inline code renders')
  assert.match(html, /<strong>bold<\/strong>/, 'bold renders')
  assert.doesNotMatch(html, /<img/, 'raw markup never becomes an element')
  assert.match(html, /&lt;img src=x onerror=alert\(1\)&gt;/, 'raw markup is escaped text')
})

test('the panel shows the empty state when no reviews exist', async t => {
  const mounted = await mountPanel({ reviews: [] })
  t.after(mounted.unmount)
  const empty = document.querySelector('[data-state="empty"]')
  assert.ok(empty, 'empty state renders')
  assert.match(empty.textContent, /当前工作区还没有评审/)
  assert.equal(document.querySelector('[data-testid="checkpoint-card"]'), null, 'no checkpoint card without a review')
  assertReadOnly(mounted.requests)
})
