import { test } from 'node:test'
import assert from 'node:assert/strict'
import { satellitePosition, resourceCaption, readResource, validPlace } from './explorer-model.js'
const satellite = { epoch_utc: '2026-11-02T10:25:21.580Z',
  line1: '1 25544U 98067A   26306.43427755  .00005374  00000+0  10508-3 0  9999',
  line2: '2 25544  51.6332 335.9757 0007139 339.3739  20.6961 15.49150046593183' }
test('SGP4 produces a plausible ISS altitude and dated position; old or invalid elements produce no point', () => {
  const p = satellitePosition(satellite, new Date('2026-11-02T22:30:00Z'))
  assert.ok(validPlace(p.lat, p.lon))
  assert.ok(p.height > 300000 && p.height < 500000)
  assert.equal(satellitePosition(satellite, new Date('2026-11-10T22:30:00Z')), null)
  assert.equal(satellitePosition({ line1: 'bad', line2: 'bad' }), null)
})
test('unknown capture time, historical photo, receipt read time and orbital epoch stay distinct', () => {
  const receipt = { retrieved_at_utc: '2026-11-02T22:30:00Z' }
  assert.match(resourceCaption({ kind: 'CAMERA_SNAPSHOT', source_updated_at_utc: receipt.retrieved_at_utc, receipt }), /prise de vue non horodatée/)
  assert.match(resourceCaption({ kind: 'HISTORICAL_PHOTO', captured_at_utc: '2023-08-03T12:00:00Z', receipt }), /2023.*lu le.*2026/)
  assert.match(resourceCaption({ kind: 'ORBITAL_ELEMENTS', ...satellite, receipt }), /calculée SGP4/)
})
test('API client stays same-origin and refuses writable or untyped authority', async t => {
  let options, url
  const original = globalThis.fetch; t.after(() => { globalThis.fetch = original })
  globalThis.fetch = async (u, o) => { url = u; options = o; return new Response(JSON.stringify({ schema: 'SPECTRA_GEOGRAPHIC_RESOURCE_RESPONSE_V1', authority: { read_only: false, background_collection: false } }), { headers: { 'content-type': 'application/json' } }) }
  await assert.rejects(readResource({ view: 'satellites' }), /AUTHORITY/)
  assert.equal(url, '/n4/api/asso/spectra/geospatial?view=satellites')
  assert.equal(options.method, 'GET'); assert.equal(options.redirect, 'error')
  assert.equal(options.signal.aborted, true)
})
test('bounded media reads abort and cancel oversized streams; JSON errors are not rendered as images', async t => {
  const original = globalThis.fetch; t.after(() => { globalThis.fetch = original })
  let signal, canceled = false
  globalThis.fetch = async (_url, options) => {
    signal = options.signal
    return { ok: true, headers: new Headers({ 'content-type': 'image/jpeg' }), body: { getReader: () => ({
      read: async () => ({ done: false, value: new Uint8Array(3 * 1024 * 1024 + 1) }),
      cancel: () => { canceled = true; return new Promise(() => {}) },
    }) } }
  }
  await assert.rejects(readResource({ view: 'media', id: 'unknown' }, true), /TOO_LARGE/)
  assert.equal(signal.aborted, true); assert.equal(canceled, true)
  globalThis.fetch = async () => new Response('{"error":"NO_IMAGERY_COVERAGE"}', { status: 404, headers: { 'content-type': 'application/json' } })
  await assert.rejects(readResource({ view: 'imagery', lat: 0, lon: 0 }, true), /NO_IMAGERY_COVERAGE/)
})
