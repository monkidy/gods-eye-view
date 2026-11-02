import assert from 'node:assert/strict'
import { test } from 'node:test'
import { normalize, filterPoints } from './model.js'
const now = Date.parse('2026-11-02T15:00:00Z')
const row = (change = {}) => ({
  intel_id: 'us-123', source_id: 'usgs_earthquakes_global_free', proof_state: 'OBSERVED', has_receipt: true,
  lat: 37.1, lon: -122.2, observed_at_utc: '2026-11-02T14:45:00Z',
  headline: 'Séisme', freshness: 'FRESH', external_provenance_url: 'https://earthquake.usgs.gov/earthquakes/eventpage/us123', ...change,
})
test('admit fresh observed official point', () => assert.equal(normalize({ items: [row()] }, now).points.length, 1))
test('separate ageing from fresh, never fake live', () => {
  const ageing = row({ freshness: 'AGEING' })
  const { points } = normalize({ items: [ageing] }, now)
  assert.equal(filterPoints(points, 'fresh').length, 0)
  assert.equal(filterPoints(points, 'ageing').length, 1)
})
test('reject unknown source, invalid location, stale beyond 7 days', () => {
  for (const bad of [{ source_id: 'unknown' }, { lat: 98 }, { lon: Infinity }, { observed_at_utc: '2026-10-01T00:00:00Z' }, { proof_state: 'CANDIDATE' }, { has_receipt: false }]) assert.equal(normalize({ items: [row(bad)] }, now).points.length, 0)
})
test('reject URL host forgery and future observation', () => {
  for (const bad of [{ external_provenance_url: 'https://earthquake.usgs.gov.evil.test/abc' }, { observed_at_utc: '2026-12-01T00:00:00Z' }]) assert.equal(normalize({ items: [row(bad)] }, now).points.length, 0)
})
test('deduplication and no interpolation', () => assert.equal(normalize({ items: [row(), row(), row({ intel_id: 'x', lat: null })] }, now).points.length, 1))
