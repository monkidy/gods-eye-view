import assert from 'node:assert/strict'
import { test } from 'node:test'
import { normalize, filterPoints } from './model.js'
const now = Date.parse('2026-11-02T15:00:00Z')
const usgs = (change = {}) => ({
  intel_id: 'us-123', source_id: 'usgs_earthquakes_global_free', proof_state: 'OBSERVED',
  receipt_id: 'receipt-238', geo: { kind: 'POINT', lat: 37.1, lon: -122.2 },
  observed_at_utc: '2026-11-02T14:45:00Z', headline: 'Séisme',
  freshness: 'FRESH', external_provenance_url: 'https://earthquake.usgs.gov/earthquakes/eventpage/us123',
  ...change,
})
const data = (...rows) => ({ intel_items: rows })
test('EONET consumes the existing source ID and never rejuvenates an old event from its recent read', () => {
  const eonet = usgs({ source_id: 'nasa_eonet_open_events_public', external_provenance_url: 'https://eonet.gsfc.nasa.gov/api/v3/events/test',
    published_at_utc: '2026-08-03T12:00:00Z' })
  const item = normalize(data(eonet), now).points[0]
  assert.equal(item.freshness, 'AGEING')
  assert.equal(item.publishedAt, eonet.published_at_utc)
  assert.equal(normalize(data({ ...eonet, published_at_utc: '2026-11-02T10:00:00Z' }), now).points[0].freshness, 'FRESH')
  assert.equal(normalize(data({ ...eonet, published_at_utc: null }), now).points[0].freshness, 'AGEING')
})
test('read actual war-room intel_items and POINT WGS84 with receipt', () => {
  const model = normalize(data(usgs()), now)
  assert.equal(model.points.length, 1)
  assert.equal(model.total, 1)
  assert.equal(model.points[0].receipt, 'receipt-238')
})
test('accept bounded nested war-room contract', () =>
  assert.equal(normalize({ data: { intel_items: [usgs()] } }, now).points.length, 1))
test('never treat has_receipt true as an actual receipt', () => {
  assert.equal(normalize(data(usgs({ receipt_id: null, has_receipt: true })), now).points.length, 0)
})
test('never infer a location from top-level lat/lon or a COUNTRY geometry', () => {
  assert.equal(normalize(data(usgs({ geo: undefined, lat: 35, lon: 11 })), now).points.length, 0)
  assert.equal(normalize(data(usgs({ geo: { kind: 'COUNTRY', lat: 35, lon: 11 } })), now).points.length, 0)
})
test('refuse all invalid coordinates and non-numeric coordinate strings', () => {
  for (const [lat, lon] of [[95, 10], [0, -181], [null, 11], ['13', 42], [NaN, 0], [Infinity, 0]]) {
    assert.equal(normalize(data(usgs({ geo: { kind: 'POINT', lat, lon } })), now).points.length, 0)
  }
})
test('require observed proof state, receipt and official HTTPS provenance', () => {
  for (const change of [
    { source_id: 'unknown' }, { proof_state: 'PRODUCED' }, { receipt_id: '' },
    { external_provenance_url: 'https://earthquake.usgs.gov.evil.invalid/data' },
    { external_provenance_url: 'http://earthquake.usgs.gov/data' },
    { external_provenance_url: 'https://user@earthquake.usgs.gov/path' },
  ]) assert.equal(normalize(data(usgs(change)), now).points.length, 0)
})
test('reject future, malformed and older than seven days', () => {
  for (const at of ['2026-12-01T10:00:00Z', '2026-11-02', '2026-10-01T00:00:00Z']) {
    assert.equal(normalize(data(usgs({ observed_at_utc: at })), now).points.length, 0)
  }
})
test('downgrade stale reported FRESH; never upgrade AGEING', () => {
  const tooOldForFresh = usgs({ observed_at_utc: '2026-11-02T12:00:00Z' })
  const ageing = usgs({ intel_id: 'older', freshness: 'AGEING' })
  const model = normalize(data(tooOldForFresh, ageing), now)
  assert.deepEqual(model.points.map(p => p.freshness), ['AGEING', 'AGEING'])
  assert.equal(filterPoints(model.points, 'fresh').length, 0)
})
test('refuse upstream STALE and unknown states even with a recent valid receipt', () => {
  for (const freshness of ['STALE', 'UNKNOWN', 'ACTIVE', '', null]) {
    const points = normalize(data(usgs({ freshness })), now).points
    assert.equal(points.length, 0)
    assert.equal(filterPoints(points, 'all').length, 0)
  }
})
test('require a real UTC calendar date, including leap-year rules', () => {
  for (const [at, clock] of [
    ['2026-02-31T12:00:00Z', '2026-03-03T12:10:00Z'],
    ['2026-02-29T12:00:00Z', '2026-03-01T12:10:00Z'],
    ['2024-04-31T12:00:00Z', '2024-05-01T12:10:00Z'],
    ['2024-02-29T24:00:00Z', '2024-03-01T00:10:00Z'],
  ]) {
    assert.equal(normalize(data(usgs({ observed_at_utc: at })), Date.parse(clock)).points.length, 0, at)
  }
  for (const at of ['2024-02-29T12:00:00Z', '2024-02-29T12:00:00.125Z']) {
    const points = normalize(data(usgs({ observed_at_utc: at })), Date.parse('2024-02-29T12:10:00Z')).points
    assert.equal(points.length, 1, at)
    assert.equal(points[0].freshness, 'FRESH')
  }
})
test('GDACS internal feed accepted with its own host, but never exported', () => {
  const gdacs = usgs({
    source_id: 'gdacs_global_disasters_free',
    external_provenance_url: 'https://www.gdacs.org/report/123',
  })
  assert.equal(normalize(data(gdacs), now).points.length, 1)
  assert.equal(normalize(data(gdacs), now).points[0].source, 'gdacs_global_disasters_free')
})
test('deduplicate IDs and filter by enabled layers', () => {
  const points = normalize(data(usgs(), usgs(), usgs({ intel_id: 'other' })), now).points
  assert.equal(points.length, 2)
  assert.equal(filterPoints(points, 'all', new Set(['gdacs_global_disasters_free'])).length, 0)
})
test('bounded scan and point caps with truthful truncated marker', () => {
  const rows = Array.from({ length: 2401 }, (_, i) => usgs({ intel_id: 'us-' + i }))
  const model = normalize(data(...rows), now)
  assert.equal(model.total, 2401)
  assert.ok(model.points.length <= 300)
  assert.equal(model.truncated, true)
})
test('sanitize headlines and keep sources linked to official hosts', () => {
  const model = normalize(data(usgs({ headline: 'Event\u0000\u0007 important' })), now)
  assert.equal(model.points[0].title, 'Event   important')
  assert.ok(model.points[0].url.startsWith('https://earthquake.usgs.gov/'))
})
