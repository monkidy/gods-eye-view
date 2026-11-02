import { twoline2satrec, propagate, gstime, eciToGeodetic } from 'satellite.js'

export const RESOURCE_ROUTE = '/n4/api/asso/spectra/geospatial'
export const validPlace = (lat, lon) => Number.isFinite(lat) && Number.isFinite(lon) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180
export const formatTime = value => value && Number.isFinite(Date.parse(value))
  ? new Date(value).toLocaleString('fr-FR', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'UTC' }) + ' UTC' : 'inconnue'
export function resourceCaption(item) {
  const read = ' · lu le ' + formatTime(item.receipt?.retrieved_at_utc)
  if (item.kind === 'CAMERA_SNAPSHOT') return 'Photo de caméra · prise de vue non horodatée' + read
  if (item.kind === 'HISTORICAL_PHOTO') return 'Photo historique · prise le ' + formatTime(item.captured_at_utc) + read
  if (item.kind === 'ORBITAL_ELEMENTS') return 'Position calculée SGP4 · éléments du ' + formatTime(item.epoch_utc) + read
  return 'Alerte publiée le ' + formatTime(item.published_at_utc) + ' · expire le ' + formatTime(item.expires_at_utc) + read
}
export function satellitePosition(item, at = new Date()) {
  try {
    if (at - new Date(item.epoch_utc) > 7 * 86400000) return null
    const sat = twoline2satrec(item.line1, item.line2)
    const position = propagate(sat, at)?.position
    if (!position || sat.error) return null
    const geo = eciToGeodetic(position, gstime(at))
    const lat = geo.latitude * 180 / Math.PI, lon = geo.longitude * 180 / Math.PI
    return validPlace(lat, lon) && Number.isFinite(geo.height) && geo.height >= 0
      ? { lat, lon, height: geo.height * 1000 } : null
  } catch { return null }
}
// One bounded same-origin request. No streaming media, upstream URL, auth
// token, automatic retry or third-party browser connection is accepted.
export async function readResource(params, binary = false) {
  const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 30000)
  let reader
  try {
    const response = await fetch(RESOURCE_ROUTE + '?' + new URLSearchParams(params), {
      method: 'GET', credentials: 'same-origin', cache: 'no-store', redirect: 'error', signal: controller.signal,
      headers: { Accept: binary ? 'image/png,image/jpeg' : 'application/json' },
    })
    const cap = binary ? 3 * 1024 * 1024 : 2 * 1024 * 1024
    if (Number(response.headers.get('content-length') || 0) > cap) throw Error('RESPONSE_TOO_LARGE')
    reader = response.body?.getReader()
    if (!reader) throw Error('RESPONSE_BODY_MISSING')
    const chunks = []; let size = 0
    for (;;) {
      const { value, done } = await reader.read()
      if (done) break
      size += value.byteLength
      if (size > cap) throw Error('RESPONSE_TOO_LARGE')
      chunks.push(value)
    }
    const bytes = new Uint8Array(size); let offset = 0
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength }
    const type = response.headers.get('content-type') || ''
    if (!response.ok) {
      let code = 'RESOURCE_UNAVAILABLE'
      try { code = JSON.parse(new TextDecoder().decode(bytes)).error || code } catch {}
      throw Error(code)
    }
    if (binary) {
      if (!['image/png', 'image/jpeg'].includes(type)) throw Error('IMAGE_FORMAT_REFUSED')
      return { blob: new Blob([bytes], { type }), readAt: response.headers.get('x-worldseye-retrieved-at'),
        sha256: response.headers.get('x-worldseye-image-sha256'), day: response.headers.get('x-worldseye-imagery-day') }
    }
    if (!type.includes('json')) throw Error('RESPONSE_FORMAT_REFUSED')
    const value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes))
    if (value.schema !== 'SPECTRA_GEOGRAPHIC_RESOURCE_RESPONSE_V1' || value.authority?.read_only !== true || value.authority?.background_collection !== false) throw Error('RESPONSE_AUTHORITY_REFUSED')
    return value
  } finally {
    clearTimeout(timer); controller.abort()
    if (reader) { try { Promise.resolve(reader.cancel()).catch(() => {}) } catch {} }
  }
}
