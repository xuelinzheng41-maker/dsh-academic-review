/**
 * Shared fixtures for the dsh-academic-review unit tests.
 *
 * Every test runs against a throwaway workspace under the OS temp directory so
 * the repository never accumulates review state.
 */
import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/** Minimal manuscript used by the lifecycle tests. */
export const PAPER_TEXT = [
  '# Grain-ball clustering for noisy labels',
  '',
  '## 1 Introduction',
  'We study granular-ball clustering under label noise and claim a 3.1 point gain.',
  '',
  '## 2 Method',
  'We define the granular ball radius as the maximum distance to the centroid.',
  '',
  '## 3 Results',
  'Accuracy improves from 81.2 to 84.3 on three benchmarks, with a single seed.',
  '',
].join('\n')

/** Create a throwaway workspace plus one .md manuscript. */
export async function makeWorkspace(label = 'review') {
  const root = await mkdtemp(join(tmpdir(), 'dsh-academic-review-' + label + '-'))
  const paper = join(root, 'manuscript.md')
  await writeFile(paper, PAPER_TEXT, 'utf8')
  return {
    root,
    paper,
    cleanup: async () => {
      await rm(root, { recursive: true, force: true })
    },
  }
}

/** ISO-8601 timestamp with the local UTC offset. */
export function stamp(date = new Date()) {
  const pad = (value, width = 2) => String(Math.abs(value)).padStart(width, '0')
  const offset = -date.getTimezoneOffset()
  const sign = offset >= 0 ? '+' : '-'
  return String(date.getFullYear()) + '-' + pad(date.getMonth() + 1) + '-' + pad(date.getDate())
    + 'T' + pad(date.getHours()) + ':' + pad(date.getMinutes()) + ':' + pad(date.getSeconds())
    + sign + pad(Math.trunc(Math.abs(offset) / 60)) + ':' + pad(Math.abs(offset) % 60)
}

/** One evidence-bearing finding. */
export function finding(id, overrides = {}) {
  return {
    id,
    severity: 'major',
    title: 'Claim ' + id + ' overreaches the evidence',
    detail: 'The stated gain rests on a single seed and three benchmarks.',
    evidence: [{ quote: 'Accuracy improves from 81.2 to 84.3', location: 'section 3, Results' }],
    ...overrides,
  }
}

/** One complete seat report body. */
export function seatReport(overrides = {}) {
  return {
    verdict: 'major_revision',
    confidence: 0.72,
    created_at: stamp(),
    summary: 'The claim is interesting but the evaluation is thin.',
    findings: [finding('F1')],
    ...overrides,
  }
}

/** Field analysis with the four reviewer configuration cards. */
export function fieldAnalysis(overrides = {}) {
  return {
    analyst_run_at: stamp(),
    primary_discipline: 'Machine learning',
    secondary_disciplines: ['Granular computing'],
    research_paradigm: 'Empirical',
    methodology_type: 'Quantitative benchmark study',
    target_journal_tier: 'Q1',
    paper_maturity: 'Revise before submission',
    configuration_cards: [
      { seat: 'eic', identity: 'Q1 ML journal editor', expertise: 'Editorial fit', focus: 'Scope and novelty' },
      { seat: 'methodology', identity: 'Empirical ML methodologist', expertise: 'Evaluation protocols', focus: 'Seeds, statistics' },
      { seat: 'domain', identity: 'Granular computing researcher', expertise: 'Rough sets', focus: 'Positioning' },
      { seat: 'perspective', identity: 'Industry practitioner', expertise: 'Deployment', focus: 'Practical impact' },
    ],
    ...overrides,
  }
}

/**
 * Assert that a promise rejects with one ReviewError code.
 * @param promise - pending work.
 * @param code - expected ReviewError code.
 */
export async function rejectsCode(promise, code) {
  await assert.rejects(promise, error => {
    assert.equal(error.code, code, 'expected code ' + code + ', got ' + String(error.code) + ': ' + error.message)
    return true
  })
}

/**
 * Mount the plugin on real cordis registries so tests exercise the exact tool
 * surface a chat session gets (no direct ReviewStore calls).
 * @param config - plugin config, usually { stateDir, workspaceRoot }.
 */
export async function mountReviewPlugin(config) {
  const { Context } = await import('@deepseek-ai/cordis')
  const { SkillRegistry } = await import('@deepseek-ai/dsh-skill')
  const { ToolRuntime } = await import('@deepseek-ai/dsh-tools')
  const plugin = await import('../lib/index.js')
  const ctx = new Context()
  // ToolRuntime publishes its schema section through the system-prompt service.
  ctx.provide('systemPrompt', { tools: () => () => {}, section: () => () => {} })
  const skills = new SkillRegistry(ctx)
  const tools = new ToolRuntime(ctx)
  plugin.apply(ctx, config)
  return { ctx, skills, tools }
}

/** Run one tool through the registry's own dispatch pipeline. */
export async function callTool(tools, name, args, callId) {
  return tools.execute({
    callId: callId ?? name + '-' + String(Math.random()).slice(2, 8),
    name,
    arguments: args,
    signal: AbortSignal.timeout(30000),
  })
}

/** Flatten a tool result's content blocks into one string. */
export function rendered(result) {
  return result.content.map(block => (block.text === undefined ? '' : block.text)).join('\n')
}

/** Assert a tool call failed and mention the expected failure text. */
export function expectFailure(result, pattern) {
  assert.equal(result.isError, true, 'expected the call to fail, got: ' + rendered(result))
  const text = rendered(result)
  assert.match(text, pattern)
  return text
}
