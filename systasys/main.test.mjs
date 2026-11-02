import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import vm from 'node:vm'
import { FEEDS, normalize, filterPoints } from './model.js'

const now = Date.now()
const row = (change = {}) => ({
  intel_id: 'us-123', source_id: 'usgs_earthquakes_global_free', proof_state: 'OBSERVED',
  receipt_id: 'receipt-238', geo: { kind: 'POINT', lat: 37.1, lon: -122.2 },
  observed_at_utc: new Date(now - 60000).toISOString(), headline: 'Séisme',
  freshness: 'FRESH', external_provenance_url: 'https://earthquake.usgs.gov/earthquakes/eventpage/us123',
  ...change,
})
class Element {
  constructor() { this.textContent = ''; this.hidden = false; this.attributes = new Map(); this.children = [] }
  addEventListener() {}
  setAttribute(key, value) { this.attributes.set(key, value) }
  removeAttribute(key) { this.attributes.delete(key); if (key === 'href') delete this.href }
  replaceChildren() { this.children = [] }
  append(child) { this.children.push(child) }
}
async function harness() {
  const elements = new Map()
  let result = new Error('NO_INITIAL_DATA')
  const document = {
    getElementById: id => {
      if (!elements.has(id)) elements.set(id, new Element())
      return elements.get(id)
    },
    createElement: () => new Element(), querySelectorAll: () => [],
  }
  const source = readFileSync(new URL('./main.js', import.meta.url), 'utf8')
    .replace(/^import .*\n/gm, '') + '\nglobalThis.hooks = { state, select, render, readData, fetchBoundedWarRoom };'
  const context = vm.createContext({
    document, window: {}, FEEDS, normalize, filterPoints,
    createExplorer: () => ({ selectPlace() {}, attach() {}, pick() {} }),
    Cesium: { buildModuleUrl: { setBaseUrl() {} }, Viewer: class { constructor() { throw Error('NO_WEBGL_IN_UNIT_TEST') } } },
    fetch: async (...args) => {
      if (result instanceof Error) throw result
      return typeof result === 'function' ? result(...args) : new Response(JSON.stringify(result), { headers: { 'content-type': 'application/json' } })
    },
    AbortController, setTimeout, clearTimeout, TextDecoder, Uint8Array,
  })
  vm.runInContext(source, context, { filename: 'systasys/main.js' })
  await new Promise(resolve => setImmediate(resolve))
  return { hooks: context.hooks, element: document.getElementById, setResult: value => { result = value } }
}
async function load(h, ...rows) {
  h.setResult({ intel_items: rows })
  await h.hooks.readData()
}
function assertCleared(h) {
  assert.equal(h.hooks.state.selectedId, null)
  assert.equal(h.element('event-meta').textContent, '')
  assert.equal(h.element('event-source').hidden, true)
  assert.equal(h.element('event-source').href, undefined)
}
test('a failed refresh removes the selected receipt, link and old FRESH claim', async () => {
  const h = await harness()
  await load(h, row())
  h.hooks.select(h.hooks.state.points[0])
  assert.match(h.element('event-meta').textContent, /FRESH.*receipt-238/)
  assert.equal(h.element('event-source').hidden, false)
  h.setResult(new Error('FETCH_REFUSED'))
  await h.hooks.readData()
  assertCleared(h)
  assert.equal(h.element('stat-visible').textContent, '0')
})
test('disabling a layer or filtering away a point clears its inspector', async () => {
  const h = await harness()
  await load(h, row())
  h.hooks.select(h.hooks.state.points[0])
  h.hooks.state.enabled.clear()
  h.hooks.render()
  assertCleared(h)
  h.hooks.state.enabled.add('usgs_earthquakes_global_free')
  h.hooks.render()
  h.hooks.select(h.hooks.state.points[0])
  h.hooks.state.period = 'ageing'
  h.hooks.render()
  assertCleared(h)
})
test('refresh reconciles the selected ID to current fields and never revives an old object', async () => {
  const h = await harness()
  await load(h, row())
  const previous = h.hooks.state.points[0]
  h.hooks.select(previous)
  h.hooks.state.period = 'all'
  await load(h, row({ freshness: 'AGEING', receipt_id: 'receipt-new', headline: 'Actualisé' }))
  assert.equal(h.element('event-title').textContent, 'Actualisé')
  assert.match(h.element('event-meta').textContent, /AGEING.*receipt-new/)
  assert.doesNotMatch(h.element('event-meta').textContent, /FRESH|receipt-238/)
  await load(h, row({ freshness: 'STALE' }))
  h.hooks.select(previous)
  assertCleared(h)
})
test('oversized streaming body is canceled and its request is aborted on refusal', async () => {
  const h = await harness()
  let canceled = false
  let released = false
  let signal
  h.setResult((_url, options) => {
    signal = options.signal
    return {
      ok: true, headers: new Headers({ 'content-type': 'application/json' }),
      body: { getReader: () => ({
        read: async () => ({ done: false, value: new Uint8Array(1048577) }),
        cancel: async () => { canceled = true },
        releaseLock: () => { released = true },
      }) },
    }
  })
  await assert.rejects(h.hooks.fetchBoundedWarRoom(), /OVER_SIZE/)
  assert.equal(canceled, true)
  assert.equal(released, true)
  assert.equal(signal.aborted, true)
})
test('oversized declared length aborts before a stream reader is opened', async () => {
  const h = await harness()
  let signal
  let opened = false
  h.setResult((_url, options) => {
    signal = options.signal
    return { ok: true, headers: new Headers({ 'content-type': 'application/json', 'content-length': '1048577' }),
      body: { getReader: () => { opened = true; throw Error('MUST_NOT_OPEN') } } }
  })
  await assert.rejects(h.hooks.fetchBoundedWarRoom(), /OVER_SIZE/)
  assert.equal(opened, false)
  assert.equal(signal.aborted, true)
})
test('pending or failed cancellation cannot stall refusal or disable later refreshes', async () => {
  for (const cancel of [
    () => new Promise(() => {}),
    () => { throw Error('CANCEL_SYNC_FAILURE') },
    () => Promise.reject(Error('CANCEL_ASYNC_FAILURE')),
  ]) {
    const h = await harness()
    await load(h, row())
    h.hooks.select(h.hooks.state.points[0])
    let signal
    let canceled = false
    let released = false
    h.setResult((_url, options) => {
      signal = options.signal
      return { ok: true, headers: new Headers({ 'content-type': 'application/json' }),
        body: { getReader: () => ({
          read: async () => ({ done: false, value: new Uint8Array(1048577) }),
          cancel: () => { canceled = true; return cancel() },
          releaseLock: () => { released = true },
        }) } }
    })
    let deadline
    try {
      await Promise.race([
        h.hooks.readData(),
        new Promise((_resolve, reject) => { deadline = setTimeout(() => reject(Error('REFUSAL_DID_NOT_SETTLE')), 200) }),
      ])
    } finally { clearTimeout(deadline) }
    assert.equal(signal.aborted, true)
    assert.equal(canceled, true)
    assert.equal(released, true)
    assert.equal(h.hooks.state.inFlight, false)
    assert.equal(h.element('refresh').disabled, false)
    assertCleared(h)
    await load(h, row())
    assert.equal(h.hooks.state.points.length, 1, 'a later refresh must remain usable')
  }
})
