/**
 * Schema-validation tests for seat reports: required fields, closed enums,
 * evidence discipline, and the honest-provenance rule.
 */
import assert from 'node:assert/strict'
import test from 'node:test'
import { validateSeatReportBody } from '../lib/state.js'
import { finding, seatReport, stamp } from './helpers.mjs'

test('a complete report validates and normalizes', () => {
  const body = validateSeatReportBody(seatReport(), 'eic', 'EIC')
  assert.equal(body.verdict, 'major_revision')
  assert.equal(body.confidence, 0.72)
  assert.equal(body.findings.length, 1)
  assert.equal(body.findings[0].id, 'F1')
  assert.deepEqual(body.findings[0].evidence[0].location, 'section 3, Results')
})

test('required fields are enforced', () => {
  assert.throws(() => validateSeatReportBody({ ...seatReport(), verdict: undefined }, 'eic', 'EIC'), /verdict must be one of/)
  assert.throws(() => validateSeatReportBody({ ...seatReport(), confidence: undefined }, 'eic', 'EIC'), /confidence must be a number/)
  assert.throws(() => validateSeatReportBody({ ...seatReport(), created_at: undefined }, 'eic', 'EIC'), /created_at must be an ISO-8601/)
  assert.throws(() => validateSeatReportBody({ ...seatReport(), findings: undefined }, 'eic', 'EIC'), /findings must be an array/)
  assert.throws(() => validateSeatReportBody(null, 'eic', 'EIC'), /report must be an object/)
})

test('closed enums are enforced', () => {
  assert.throws(
    () => validateSeatReportBody(seatReport({ verdict: 'looks_fine' }), 'eic', 'EIC'),
    /verdict must be one of accept\|minor_revision\|major_revision\|reject/,
  )
  assert.throws(
    () => validateSeatReportBody(seatReport({ findings: [finding('F1', { severity: 'fatal' })] }), 'eic', 'EIC'),
    /severity must be one of critical\|major\|minor\|comment/,
  )
})

test('confidence stays inside [0, 1]', () => {
  assert.throws(() => validateSeatReportBody(seatReport({ confidence: 1.4 }), 'eic', 'EIC'), /between 0 and 1/)
  assert.throws(() => validateSeatReportBody(seatReport({ confidence: -0.1 }), 'eic', 'EIC'), /between 0 and 1/)
  assert.throws(() => validateSeatReportBody(seatReport({ confidence: Number.NaN }), 'eic', 'EIC'), /between 0 and 1/)
})

test('timestamps need an explicit UTC offset', () => {
  assert.throws(
    () => validateSeatReportBody(seatReport({ created_at: '2026-10-27T10:00:00' }), 'eic', 'EIC'),
    /ISO-8601/,
  )
  assert.throws(
    () => validateSeatReportBody(seatReport({ created_at: stamp().replace('T', ' ') }), 'eic', 'EIC'),
    /ISO-8601/,
  )
  assert.doesNotThrow(() => validateSeatReportBody(seatReport({ created_at: stamp() }), 'eic', 'EIC'))
})

test('every finding needs at least one quote with a location', () => {
  assert.throws(
    () => validateSeatReportBody(seatReport({ findings: [finding('F1', { evidence: [] })] }), 'eic', 'EIC'),
    /evidence must list at least one/,
  )
  assert.throws(
    () => validateSeatReportBody(seatReport({ findings: [finding('F1', { evidence: [{ quote: '   ', location: 'p1' }] })] }), 'eic', 'EIC'),
    /quote must be a non-empty string/,
  )
  assert.throws(
    () => validateSeatReportBody(seatReport({ findings: [finding('F1', { evidence: [{ quote: 'x', location: '' }] })] }), 'eic', 'EIC'),
    /location must be a non-empty string/,
  )
})

test('finding ids must be unique inside one report', () => {
  assert.throws(
    () => validateSeatReportBody(seatReport({ findings: [finding('F1'), finding('F1')] }), 'eic', 'EIC'),
    /duplicate finding id/,
  )
})

test('a report may not claim access to peer output', () => {
  assert.throws(
    () => validateSeatReportBody(seatReport({ provenance: { peerOutputVisible: true } }), 'eic', 'EIC'),
    /peerOutputVisible must be false/,
  )
  const body = validateSeatReportBody(
    seatReport({ provenance: { model: 'deepseek-v4', peerOutputVisible: false, contextFresh: true } }),
    'eic',
    'EIC',
  )
  assert.equal(body.provenance.model, 'deepseek-v4')
  assert.equal(body.provenance.contextFresh, true)
})

test('a seat cannot submit under another seat or role marker', () => {
  assert.throws(
    () => validateSeatReportBody({ ...seatReport(), seat_id: 'da' }, 'eic', 'EIC'),
    /does not match seat "eic"/,
  )
  assert.throws(
    () => validateSeatReportBody({ ...seatReport(), role: 'DA' }, 'eic', 'EIC'),
    /role marker "EIC"/,
  )
})
