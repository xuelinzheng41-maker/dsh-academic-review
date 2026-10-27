/**
 * Mount tests against the real cordis services: the plugin must register its
 * five tools on ctx.tools and its skill provider on ctx.skills when applied to
 * an ordinary Context, and a tool call must run end to end through the
 * registry's own dispatch pipeline.
 */
import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { Context } from '@deepseek-ai/cordis'
import { SkillRegistry } from '@deepseek-ai/dsh-skill'
import { ToolRuntime } from '@deepseek-ai/dsh-tools'
import * as plugin from '../lib/index.js'

/** Build a context whose tools and skills services are the real registries. */
function mount(config) {
  const ctx = new Context()
  // ToolRuntime publishes its schema section through the system-prompt service;
  // a recorder is enough for a headless mount.
  ctx.provide('systemPrompt', { tools: () => () => {}, section: () => () => {} })
  const skills = new SkillRegistry(ctx)
  const tools = new ToolRuntime(ctx)
  plugin.apply(ctx, config)
  return { ctx, skills, tools }
}

/** Create one temp workspace with a manuscript. */
async function workspace() {
  const root = await mkdtemp(join(tmpdir(), 'dsh-ar-mount-'))
  const paper = join(root, 'paper.md')
  await writeFile(paper, '# Paper\n\nWe claim X improves Y by 3 points.\n', 'utf8')
  return { root, paper, cleanup: async () => { await rm(root, { recursive: true, force: true }) } }
}

test('applying the plugin registers five tools and both vendored skills', async t => {
  const space = await workspace()
  t.after(space.cleanup)
  const { skills, tools } = mount({ stateDir: '.academic-review', workspaceRoot: space.root })

  const names = tools.schemas().map(schema => schema.name).sort()
  assert.deepEqual(names, [
    'academic_review_confirm',
    'academic_review_create',
    'academic_review_report',
    'academic_review_status',
    'academic_review_submit',
  ])

  const summaries = await skills.list({ cwd: space.root })
  assert.deepEqual(summaries.map(summary => summary.name), ['academic-paper-reviewer', 'deep-research'])
  assert.equal(summaries[0].provider, 'academic-review')
  assert.equal(summaries[1].provider, 'academic-review')
  // Both resource bases are absolute directories under the packaged vendor tree.
  assert.equal(summaries[0].resourceBase.path, join(process.cwd(), 'vendor', 'academic-paper-reviewer'))
  assert.equal(summaries[1].resourceBase.path, join(process.cwd(), 'vendor', 'deep-research'))
  // deep-research is prompt-only: the plugin adds no tool for it.
  assert.equal(tools.schemas().filter(schema => schema.name.includes('research')).length, 0)
})

test('a create call runs end to end through the tool registry', async t => {
  const space = await workspace()
  t.after(space.cleanup)
  const { tools } = mount({ stateDir: '.academic-review', workspaceRoot: space.root })

  const result = await tools.execute({
    callId: 'call-create-1',
    name: 'academic_review_create',
    arguments: { paper_path: space.paper, mode: 'methodology-focus' },
    signal: AbortSignal.timeout(30000),
  })
  assert.equal(result.isError, false)
  const value = result.value
  assert.equal(value.status, 'created')
  assert.equal(value.mode, 'methodology-focus')
  assert.deepEqual(value.seats.map(seat => seat.seat_id), ['eic', 'methodology'])
  assert.equal(value.paper_bytes, 44)
  assert.match(value.paper_sha256, /^[0-9a-f]{64}$/)

  const status = await tools.execute({
    callId: 'call-status-1',
    name: 'academic_review_status',
    arguments: { review_id: value.review_id },
    signal: AbortSignal.timeout(30000),
  })
  assert.equal(status.isError, false)
  assert.equal(status.value.status, 'created')
  assert.equal(status.value.pending_checkpoint, 'field_analysis_attachment')
})

test('a refused submit reports the failure code to the model', async t => {
  const space = await workspace()
  t.after(space.cleanup)
  const { tools } = mount({ stateDir: '.academic-review', workspaceRoot: space.root })

  const created = await tools.execute({
    callId: 'call-create-2',
    name: 'academic_review_create',
    arguments: { paper_path: space.paper },
    signal: AbortSignal.timeout(30000),
  })
  const refused = await tools.execute({
    callId: 'call-submit-1',
    name: 'academic_review_submit',
    arguments: {
      review_id: created.value.review_id,
      seat_id: 'eic',
      report: {
        verdict: 'major_revision',
        confidence: 0.6,
        created_at: '2026-10-27T10:00:00+08:00',
        findings: [{
          id: 'F1',
          severity: 'major',
          title: 'Thin evaluation',
          detail: 'One seed only.',
          evidence: [{ quote: 'We claim X improves Y by 3 points.', location: 'section 1' }],
        }],
      },
    },
    signal: AbortSignal.timeout(30000),
  })
  assert.equal(refused.isError, true)
  const rendered = refused.content.map(block => block.text ?? '').join('\n')
  assert.match(rendered, /panel_not_confirmed/)
})

test('a narrowed skills config serves only the named skill', async t => {
  const space = await workspace()
  t.after(space.cleanup)
  const { skills } = mount({ stateDir: '.academic-review', workspaceRoot: space.root, skills: ['deep-research'] })
  const summaries = await skills.list({ cwd: space.root })
  assert.deepEqual(summaries.map(summary => summary.name), ['deep-research'])
  const loaded = await skills.get('deep-research', { cwd: space.root })
  assert.equal(loaded.name, 'deep-research')
  assert.equal(loaded.metadata.upstreamSkillVersion, '2.12.1')
  assert.equal(await skills.get('academic-paper-reviewer', { cwd: space.root }), undefined)
})

test('an unknown skills config entry fails the mount with a clear message', async () => {
  const space = await workspace()
  try {
    assert.throws(
      () => mount({ stateDir: '.academic-review', workspaceRoot: space.root, skills: ['deep-resarch'] }),
      /unknown vendored skill "deep-resarch": available skills are academic-paper-reviewer, deep-research/u,
    )
  } finally {
    await space.cleanup()
  }
})
