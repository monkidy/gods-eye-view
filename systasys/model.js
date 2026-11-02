const FEEDS = Object.freeze({
  usgs_earthquakes_global_free: { label: 'USGS · Séismes', host: 'earthquake.usgs.gov', color: '#dfa76c', maxAgeMs: 7 * 86400000 },
  gdacs_global_disasters_free: { label: 'GDACS · Catastrophes', host: 'www.gdacs.org', color: '#e68778', maxAgeMs: 7 * 86400000 },
})
const MAX = 300
const safe = (value, size = 240) => typeof value === 'string' ? value.trim().slice(0, size) : ''
export function normalize(payload, now = Date.now()) {
  const rows = Array.isArray(payload?.items) ? payload.items.slice(0, 1000) : []
  const seen = new Set()
  const points = []
  for (const raw of rows) {
    if (!raw || typeof raw !== 'object' || !Object.hasOwn(FEEDS, raw.source_id)) continue
    if (raw.proof_state !== 'OBSERVED' || !raw.has_receipt || !['FRESH', 'AGEING', 'STALE'].includes(raw.freshness)) continue
    const lat = raw.lat, lon = raw.lon
    if (!Number.isFinite(lat) || !Number.isFinite(lon) || lat < -90 || lat > 90 || lon < -180 || lon > 180) continue
    const at = safe(raw.observed_at_utc, 48), ts = Date.parse(at)
    if (!Number.isFinite(ts) || ts > now + 60000 || now - ts > FEEDS[raw.source_id].maxAgeMs) continue
    const id = safe(raw.intel_id, 120)
    if (!id || seen.has(id)) continue
    const src = safe(raw.external_provenance_url, 400)
    try {
      const u = new URL(src)
      if (u.protocol !== 'https:' || u.hostname.toLowerCase() !== FEEDS[raw.source_id].host || u.port || u.username || u.password) continue
    } catch { continue }
    seen.add(id)
    points.push({
      id, lat, lon, at, title: safe(raw.headline) || 'Observation publiée',
      source: raw.source_id, freshness: raw.freshness, url: src,
    })
    if (points.length >= MAX) break
  }
  return { points, total: Number.isInteger(payload?.total) && payload.total >= 0 ? Math.min(10000, payload.total) : rows.length }
}
export function filterPoints(points, period, enabled = new Set(Object.keys(FEEDS))) {
  return points.filter(p => enabled.has(p.source) && (period === 'all' || (period === 'fresh' ? p.freshness === 'FRESH' : p.freshness !== 'FRESH')))
}
export { FEEDS }
