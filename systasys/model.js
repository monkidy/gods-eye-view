// World’s Eye is a bounded read-only projection of SPECTRA's existing war room.
// No geocoding, coordinate inference, source polling or redistribution.
export const FEEDS = Object.freeze({
  usgs_earthquakes_global_free: { label: 'USGS · Séismes', host: 'earthquake.usgs.gov', color: '#dfa76c', maxFreshMs: 60 * 60000 },
  gdacs_global_disasters_free: { label: 'GDACS · Catastrophes (interne)', host: 'www.gdacs.org', color: '#e68778', maxFreshMs: 120 * 60000 },
})
const MAX_SCAN = 2000
const MAX_POINTS = 300
const MAX_VISIBLE_MS = 7 * 86400000
const safe = (value, size = 240) => typeof value === 'string' ? value.replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, size) : ''
const finiteCoordinate = (v, low, high) => typeof v === 'number' && Number.isFinite(v) && v >= low && v <= high
function utcTimestamp(value) {
  const parts = typeof value === 'string' && /^(\d{4})-(\d\d)-(\d\d)T(\d\d):(\d\d):(\d\d)(?:\.(\d+))?Z$/.exec(value)
  if (!parts) return NaN
  const timestamp = Date.parse(value)
  if (!Number.isFinite(timestamp)) return NaN
  const date = new Date(timestamp)
  // Date.parse normalizes impossible dates such as February 31. A date-shaped
  // string is not evidence of a real UTC calendar instant.
  const actual = [date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate(),
    date.getUTCHours(), date.getUTCMinutes(), date.getUTCSeconds()]
  if (actual.some((part, index) => part !== Number(parts[index + 1]))) return NaN
  return timestamp
}

function rowsFrom(payload) {
  if (!payload || typeof payload !== 'object') return []
  const candidates = [payload, payload.data, payload.world_intel, payload.war_room, payload.data?.world_intel, payload.data?.war_room]
  for (const node of candidates) {
    if (!node || typeof node !== 'object') continue
    for (const key of ['intel_items','world_intel_items','observations','items','events']) {
      if (Array.isArray(node[key])) return node[key]
    }
  }
  return []
}
function safeSource(raw, feed) {
  const text = safe(raw.external_provenance_url, 500)
  try {
    const u = new URL(text)
    return u.protocol === 'https:' && u.hostname.toLowerCase() === feed.host &&
      !u.port && !u.username && !u.password && !u.hash ? u.href : null
  } catch { return null }
}
export function normalize(payload, now = Date.now()) {
  const rows = rowsFrom(payload)
  const seen = new Set()
  const points = []
  const safeNow = Number.isFinite(now) ? now : Date.now()
  for (const entry of rows.slice(0, MAX_SCAN)) {
    const raw = entry && typeof entry === 'object' ? (entry.item && typeof entry.item === 'object' ? entry.item : entry) : null
    if (!raw || !Object.hasOwn(FEEDS, raw.source_id)) continue
    const feed = FEEDS[raw.source_id]
    // A boolean "has_receipt" is NOT a receipt. An observed record needs its actual receipt ID.
    if (raw.proof_state !== 'OBSERVED' || !safe(raw.receipt_id, 160)) continue
    // Never promote an upstream rejection (STALE/unknown) into visible history.
    if (!['FRESH', 'AGEING'].includes(raw.freshness)) continue
    const geo = raw.geo || raw.geography
    if (!geo || geo.kind !== 'POINT' || !finiteCoordinate(geo.lat, -90, 90) || !finiteCoordinate(geo.lon, -180, 180)) continue
    const ts = utcTimestamp(raw.observed_at_utc)
    if (!Number.isFinite(ts) || ts > safeNow + 60000 || safeNow - ts > MAX_VISIBLE_MS) continue
    const id = safe(raw.intel_id, 120)
    if (!id || seen.has(id)) continue
    const url = safeSource(raw, feed)
    if (!url) continue
    const actualFresh = raw.freshness === 'FRESH' && safeNow - ts <= feed.maxFreshMs
    const freshness = actualFresh ? 'FRESH' : 'AGEING'
    seen.add(id)
    points.push({
      id, lat: geo.lat, lon: geo.lon, at: raw.observed_at_utc,
      title: safe(raw.headline) || 'Observation publiée', source: raw.source_id,
      receipt: safe(raw.receipt_id, 160), freshness, url,
    })
    if (points.length >= MAX_POINTS) break
  }
  points.sort((a,b) => Date.parse(b.at) - Date.parse(a.at))
  return { points, total: Math.min(rows.length, 100000), scanned: Math.min(rows.length, MAX_SCAN), truncated: rows.length > MAX_SCAN || points.length >= MAX_POINTS }
}
export function filterPoints(points, period, enabled = new Set(Object.keys(FEEDS))) {
  return points.filter(p => enabled.has(p.source) && (period === 'all' || (period === 'fresh' ? p.freshness === 'FRESH' : p.freshness !== 'FRESH')))
}
