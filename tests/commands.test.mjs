/**
 * Slash-command tests: `/ars-review` and `/ars-review-status` against a fake
 * command registry plus the real review state layer.
 *
 * The registry is faked (that is the host's job) but ReviewStore is not: every
 * assertion below reads the record the command wrote, so a command that grew
 * its own business logic would fail here.
 */
import assert from 'node:assert/strict'
import test from 'node:test'
import { join } from 'node:path'
import { writeFile } from 'node:fs/promises'
import { Context } from '@deepseek-ai/cordis'
import { SkillRegistry } from '@deepseek-ai/dsh-skill'
import { ToolRuntime } from '@deepseek-ai/dsh-tools'
import {
  REVIEW_COMMAND,
  REVIEW_COMMAND_HINT,
  REVIEW_STATUS_COMMAND,
  REVIEW_STATUS_COMMAND_HINT,
  registerAcademicReviewCommands,
} from '../lib/index.js'
import { ReviewStore } from '../lib/state.js'
import { fieldAnalysis, makeWorkspace, seatReport } from './helpers.mjs'

/** Host command name grammar, straight from the registry's own validator. */
const COMMAND_NAME = /^[a-z][a-z0-9_-]*$/u

/** One fake command registry recording every registration. */
function fakeCommandRegistry() {
  const definitions = new Map()
  const disposers = []
  const registry = {
    register(definition) {
      assert.match(definition.name, COMMAND_NAME, 'the host registry rejects command name ' + definition.name)
      assert.equal(typeof definition.description, 'string')
      assert.ok(definition.description.trim() !== '')
      assert.equal(typeof definition.handler, 'function')
      definitions.set(definition.name, definition)
      const dispose = () => definitions.delete(definition.name)
      disposers.push(dispose)
      return dispose
    },
  }
  return { registry, definitions, disposers }
}

/** Mount only the commands layer on a real cordis context. */
function mountCommands(config) {
  const ctx = new Context()
  const fake = fakeCommandRegistry()
  ctx.provide('commands', fake.registry)
  registerAcademicReviewCommands(ctx, config)
  return { ctx, ...fake }
}

/** One invocation as the host would build it, addressed at a session cwd. */
function invocation(rawInput, cwd) {
  return {
    commandId: 'cmd-test-1',
    agent: { session: { header: { cwd } } },
    rawInput,
    attachments: [],
    signal: AbortSignal.timeout(30000),
  }
}

/** Run one registered command. */
async function run(definitions, name, rawInput, cwd) {
  const definition = definitions.get(name)
  assert.ok(definition !== undefined, 'command ' + name + ' is not registered')
  return definition.handler(invocation(rawInput, cwd))
}

/** Assert a message is a single actionable line with no stack trace. */
function assertOneLine(text) {
  assert.equal(typeof text, 'string')
  assert.equal(text.includes('\n'), false, 'refusal must be one line, got: ' + JSON.stringify(text))
  assert.equal(/\s+at\s+\S+\s*\(/u.test(text), false, 'refusal leaked a stack frame: ' + text)
}

/** Store bound to the same workspace the tests mount. */
function storeFor(workspace) {
  return new ReviewStore({ workspace, stateDir: '.academic-review' })
}

test('both slash commands register with their documented hints', async () => {
  const space = await makeWorkspace('cmd-register')
  try {
    const { definitions } = mountCommands({ stateDir: '.academic-review', workspaceRoot: space.root })
    assert.deepEqual([...definitions.keys()].sort(), ['ars-review', 'ars-review-status'])
    assert.equal(REVIEW_COMMAND, 'ars-review')
    assert.equal(REVIEW_STATUS_COMMAND, 'ars-review-status')
    assert.equal(REVIEW_COMMAND_HINT, '[quick|full] <path-to-manuscript>')
    assert.equal(REVIEW_STATUS_COMMAND_HINT, '[review_id]')
    assert.equal(definitions.get('ars-review').input.hint, REVIEW_COMMAND_HINT)
    assert.equal(definitions.get('ars-review-status').input.hint, REVIEW_STATUS_COMMAND_HINT)
  } finally {
    await space.cleanup()
  }
})

test('the commands layer does nothing until a command registry exists', async () => {
  const space = await makeWorkspace('cmd-lazy')
  try {
    const ctx = new Context()
    registerAcademicReviewCommands(ctx, { stateDir: '.academic-review', workspaceRoot: space.root })
    const fake = fakeCommandRegistry()
    ctx.provide('commands', fake.registry)
    await Promise.resolve()
    assert.deepEqual([...fake.definitions.keys()].sort(), ['ars-review', 'ars-review-status'])
  } finally {
    await space.cleanup()
  }
})

test('/ars-review creates a review through the same state layer as the tools', async () => {
  const space = await makeWorkspace('cmd-create')
  try {
    // No workspaceRoot: the command must read the session cwd, like the tools.
    const { definitions } = mountCommands({ stateDir: '.academic-review' })
    const result = await run(definitions, 'ars-review', ' ' + space.paper, space.root)
    assert.equal(result.kind, 'success', result.text)

    const store = storeFor(space.root)
    const reviews = await store.list()
    assert.equal(reviews.length, 1)
    const state = await store.read(reviews[0].review_id)

    assert.ok(result.text.includes(state.review_id), 'review_id missing from: ' + result.text)
    assert.match(result.text, /full mode, 5 seats/u)
    for (const seatId of ['eic', 'methodology', 'domain', 'perspective', 'da']) {
      assert.ok(result.text.includes('  - ' + seatId + ' ('), 'seat ' + seatId + ' missing from: ' + result.text)
    }
    assert.match(result.text, /academic_review_confirm\(/u)
    assert.ok(result.text.includes('review_id="' + state.review_id + '"'))
    assert.match(result.text, /action="attach"/u)
    assert.match(result.text, /configuration_cards=/u)
    assert.match(result.text, /"seat": "eic"/u)
    assert.equal(state.status, 'created')
    assert.equal(state.mode, 'full')
    assert.equal(state.paper.path, space.paper)
    assert.equal(state.panel.seats.length, 5)
  } finally {
    await space.cleanup()
  }
})

test('/ars-review quick opens the EIC-only panel', async () => {
  const space = await makeWorkspace('cmd-quick')
  try {
    const { definitions } = mountCommands({ stateDir: '.academic-review', workspaceRoot: space.root })
    const result = await run(definitions, 'ars-review', 'quick ' + space.paper, space.root)
    assert.equal(result.kind, 'success', result.text)
    assert.match(result.text, /quick mode, 1 seat\)/u)
    const store = storeFor(space.root)
    const [newest] = await store.list()
    const state = await store.read(newest.review_id)
    assert.deepEqual(state.panel.seats.map(seat => seat.seat_id), ['eic'])
  } finally {
    await space.cleanup()
  }
})

test('/ars-review refuses a PDF manuscript in one actionable line', async () => {
  const space = await makeWorkspace('cmd-pdf')
  try {
    const pdf = join(space.root, 'manuscript.pdf')
    await writeFile(pdf, '%PDF-1.7 not really', 'utf8')
    const { definitions } = mountCommands({ stateDir: '.academic-review', workspaceRoot: space.root })
    const result = await run(definitions, 'ars-review', 'full ' + pdf, space.root)
    assert.equal(result.kind, 'error')
    assertOneLine(result.text)
    assert.match(result.text, /PDF/u)
    assert.match(result.text, /\.md, \.tex, or \.txt/u)
    const store = storeFor(space.root)
    assert.deepEqual(await store.list(), [], 'a refused manuscript must not create a review')
  } finally {
    await space.cleanup()
  }
})

test('/ars-review refuses a missing manuscript in one actionable line', async () => {
  const space = await makeWorkspace('cmd-missing')
  try {
    const { definitions } = mountCommands({ stateDir: '.academic-review', workspaceRoot: space.root })
    const result = await run(definitions, 'ars-review', ' ' + join(space.root, 'nope.md'), space.root)
    assert.equal(result.kind, 'error')
    assertOneLine(result.text)
    assert.match(result.text, /cannot read manuscript/u)
  } finally {
    await space.cleanup()
  }
})

test('/ars-review refuses empty input with its usage line', async () => {
  const space = await makeWorkspace('cmd-usage')
  try {
    const { definitions } = mountCommands({ stateDir: '.academic-review', workspaceRoot: space.root })
    const result = await run(definitions, 'ars-review', '   ', space.root)
    assert.equal(result.kind, 'error')
    assertOneLine(result.text)
    assert.match(result.text, /Usage: \/ars-review \[quick\|full\] <path-to-manuscript>/u)
  } finally {
    await space.cleanup()
  }
})

test('/ars-review-status defaults to the newest review in the workspace', async () => {
  const space = await makeWorkspace('cmd-status-newest')
  try {
    const store = storeFor(space.root)
    const older = await store.create({ paperPath: space.paper, mode: 'quick' })
    // updated_at has one-second resolution, so the ordering needs a real gap.
    await new Promise(resolve => { setTimeout(resolve, 1100) })
    const newer = await store.create({ paperPath: space.paper, mode: 'full' })

    const { definitions } = mountCommands({ stateDir: '.academic-review', workspaceRoot: space.root })
    const result = await run(definitions, 'ars-review-status', '', space.root)
    assert.equal(result.kind, 'success', result.text)
    assert.ok(result.text.includes('Review ' + newer.review_id + ':'), result.text)
    assert.equal(result.text.includes(older.review_id), false, 'reported the older review: ' + result.text)
    assert.match(result.text, /created \(full mode\)/u)
    assert.match(result.text, /Seats \(0\/5 submitted\)/u)
    assert.match(result.text, /Pending checkpoint: field_analysis_attachment/u)
  } finally {
    await space.cleanup()
  }
})

test('/ars-review-status names an unknown review id', async () => {
  const space = await makeWorkspace('cmd-status-unknown')
  try {
    const { definitions } = mountCommands({ stateDir: '.academic-review', workspaceRoot: space.root })
    const result = await run(definitions, 'ars-review-status', ' rev-20260101-deadbeef', space.root)
    assert.equal(result.kind, 'error')
    assertOneLine(result.text)
    assert.match(result.text, /was not found under/u)
  } finally {
    await space.cleanup()
  }
})

test('/ars-review-status reports an empty workspace', async () => {
  const space = await makeWorkspace('cmd-status-empty')
  try {
    const { definitions } = mountCommands({ stateDir: '.academic-review', workspaceRoot: space.root })
    const result = await run(definitions, 'ars-review-status', '', space.root)
    assert.equal(result.kind, 'error')
    assertOneLine(result.text)
    assert.match(result.text, /no reviews in/u)
    assert.match(result.text, /\/ars-review \[quick\|full\] <path-to-manuscript>/u)
  } finally {
    await space.cleanup()
  }
})

test('/ars-review-status renders seats, checkpoint, and decision once synthesis ran', async () => {
  const space = await makeWorkspace('cmd-status-decision')
  try {
    const { definitions } = mountCommands({ stateDir: '.academic-review', workspaceRoot: space.root })
    const created = await run(definitions, 'ars-review', 'quick ' + space.paper, space.root)
    assert.equal(created.kind, 'success', created.text)

    const store = storeFor(space.root)
    const [newest] = await store.list()
    const reviewId = newest.review_id
    const analysis = fieldAnalysis()
    await store.attachFieldAnalysis(reviewId, {
      ...analysis,
      configuration_cards: analysis.configuration_cards.filter(card => card.seat === 'eic'),
    })
    await store.confirmPanel(reviewId)
    const submitted = await store.submit(reviewId, 'eic', seatReport())
    assert.equal(submitted.state.status, 'all_submitted')
    await store.synthesize(reviewId)

    const result = await run(definitions, 'ars-review-status', ' ' + reviewId, space.root)
    assert.equal(result.kind, 'success', result.text)
    assert.match(result.text, /awaiting_synthesis_approval \(quick mode\)/u)
    assert.match(result.text, /eic \(EIC\): submitted, verdict major_revision/u)
    assert.match(result.text, /Seats \(1\/1 submitted\)/u)
    assert.match(result.text, /Pending checkpoint: report_approval/u)
    assert.match(result.text, /Decision: major_revision/u)
    assert.ok(result.text.includes('review_id="' + reviewId + '", approve=true'), result.text)
    assert.match(result.text, /academic_review_report\(review_id="/u)
  } finally {
    await space.cleanup()
  }
})

test('a command-created review is visible to the academic_review_status tool', async () => {
  const space = await makeWorkspace('cmd-tool-parity')
  try {
    const ctx = new Context()
    ctx.provide('systemPrompt', { tools: () => () => {}, section: () => () => {} })
    new SkillRegistry(ctx)
    const tools = new ToolRuntime(ctx)
    const fake = fakeCommandRegistry()
    ctx.provide('commands', fake.registry)
    const plugin = await import('../lib/index.js')
    plugin.apply(ctx, { stateDir: '.academic-review', workspaceRoot: space.root })
    assert.ok(fake.definitions.has('ars-review'))

    const created = await run(fake.definitions, 'ars-review', 'methodology-focus ' + space.paper, space.root)
    assert.equal(created.kind, 'success', created.text)
    const reviewId = created.text.slice('Review '.length).split(' ')[0]

    const status = await tools.execute({
      callId: 'call-status-from-command',
      name: 'academic_review_status',
      arguments: { review_id: reviewId },
      signal: AbortSignal.timeout(30000),
    })
    assert.equal(status.isError, false, "the tool could not read the review the command created")
    assert.equal(status.value.review_id, reviewId)
    assert.equal(status.value.status, 'created')
    assert.equal(status.value.mode, 'methodology-focus')
  } finally {
    await space.cleanup()
  }
})
