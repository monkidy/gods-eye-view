import * as Cesium from 'cesium'
import { FEEDS, normalize, filterPoints } from './model.js'
import './style.css'

// All Cesium workers, widgets and imagery must resolve to this same-origin, pinned release.
// This app never fetches third-party datasets, tiles, credentials or streaming services.
const ROOT = '/n4/worlds-eye-app/'
Cesium.buildModuleUrl.setBaseUrl(ROOT + 'cesium/')
const $ = id => document.getElementById(id)
const state = { points: [], enabled: new Set(Object.keys(FEEDS)), period: 'fresh', viewer: null, inFlight: false }
const fmt = at => new Date(at).toLocaleString('fr-FR', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'UTC' }) + ' UTC'
const status = message => { $('connection').textContent = message }
const geoStatus = message => { $('foot-status').textContent = message }

function select(item) {
  $('event-title').textContent = item.title
  $('event-body').textContent = item.freshness === 'FRESH'
    ? 'Observation officielle récente avec reçu SPECTRA.'
    : 'Observation historique datée : elle ne constitue pas une alerte actuelle.'
  $('event-meta').textContent = FEEDS[item.source].label + ' · ' + fmt(item.at) + ' · ' +
    item.freshness + ' · reçu ' + item.receipt
  $('event-source').hidden = false
  $('event-source').href = item.url
  if (state.viewer) state.viewer.camera.flyTo({
    destination: Cesium.Cartesian3.fromDegrees(item.lon, item.lat, 1800000), duration: 1.1,
  })
}

function render() {
  const filtered = filterPoints(state.points, state.period, state.enabled)
  $('stat-visible').textContent = String(filtered.length)
  $('layer-count').textContent = String(state.enabled.size)
  $('count-usgs').textContent = String(state.points.filter(p => p.source === 'usgs_earthquakes_global_free').length)
  $('count-gdacs').textContent = String(state.points.filter(p => p.source === 'gdacs_global_disasters_free').length)
  const viewer = state.viewer
  if (viewer) {
    viewer.entities.removeAll()
    for (const item of filtered) {
      const entity = viewer.entities.add({
        id: item.id, name: item.title, position: Cesium.Cartesian3.fromDegrees(item.lon, item.lat),
        point: {
          pixelSize: item.freshness === 'FRESH' ? 10 : 7,
          color: Cesium.Color.fromCssColorString(FEEDS[item.source].color).withAlpha(item.freshness === 'FRESH' ? 1 : 0.55),
          outlineColor: Cesium.Color.WHITE.withAlpha(0.7), outlineWidth: 1,
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
        },
      })
      entity.eyeRecord = item
    }
    viewer.scene.requestRender()
  }
  const list = $('event-list')
  list.replaceChildren()
  for (const item of filtered.slice(0, 40)) {
    const b = document.createElement('button')
    b.type = 'button'
    b.textContent = item.title + ' · ' + fmt(item.at) + ' · ' + item.freshness
    b.addEventListener('click', () => select(item))
    list.append(b)
  }
  geoStatus(filtered.length
    ? filtered.length + ' observations avec coordonnées et reçus vérifiés'
    : 'Aucun point admissible dans cette sélection')
}

async function fetchBoundedWarRoom() {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 7000)
  try {
    const response = await fetch('/n4/api/asso/spectra/war-room', {
      method: 'GET', credentials: 'same-origin', cache: 'no-store', redirect: 'error',
      headers: { Accept: 'application/json' }, signal: controller.signal,
    })
    if (!response.ok || !(response.headers.get('content-type') || '').includes('json')) throw Error('WAR_ROOM_UNAVAILABLE')
    if (Number(response.headers.get('content-length') || 0) > 1048576) throw Error('OVER_SIZE')
    if (!response.body) throw Error('BODY_UNAVAILABLE')
    const reader = response.body.getReader()
    const chunks = []
    let totalBytes = 0
    try {
      while (true) {
        const { value, done } = await reader.read()
        if (done) break
        totalBytes += value.byteLength
        if (totalBytes > 1048576) throw Error('OVER_SIZE')
        chunks.push(value)
      }
    } finally { reader.releaseLock() }
    const bytes = new Uint8Array(totalBytes)
    let offset = 0
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength }
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes))
  } finally { clearTimeout(timeout) }
}
async function readData() {
  if (state.inFlight) return
  state.inFlight = true
  $('refresh').disabled = true
  status('SPECTRA · lecture de la salle de guerre')
  try {
    const model = normalize(await fetchBoundedWarRoom(), Date.now())
    state.points = model.points
    $('stat-total').textContent = String(model.total)
    $('stat-other').textContent = String(Math.max(0, model.total - model.points.length))
    status('SPECTRA · réponse reçue, ' + model.points.length + ' points admissibles' + (model.truncated ? ' (limite de sécurité)' : ''))
  } catch {
    state.points = []
    $('stat-total').textContent = '—'
    $('stat-other').textContent = '—'
    status('SPECTRA inaccessible ou réponse non conforme · aucun point affirmé')
  } finally {
    state.inFlight = false
    $('refresh').disabled = false
    render()
  }
}
async function startGlobe() {
  try {
    const viewer = new Cesium.Viewer('globe', {
      terrainProvider: new Cesium.EllipsoidTerrainProvider(), baseLayer: false,
      animation: false, timeline: false, geocoder: false, homeButton: false,
      baseLayerPicker: false, sceneModePicker: false, navigationHelpButton: false,
      fullscreenButton: false, selectionIndicator: false, infoBox: false,
      skyBox: false, skyAtmosphere: false, requestRenderMode: true,
    })
    state.viewer = viewer
    viewer.resolutionScale = Math.min(window.devicePixelRatio || 1, 1.4)
    viewer.scene.globe.baseColor = Cesium.Color.fromCssColorString('#284450')
    viewer.scene.globe.maximumScreenSpaceError = 3
    viewer.scene.globe.show = true
    viewer.camera.setView({ destination: Cesium.Cartesian3.fromDegrees(10, 12, 23000000) })
    viewer.screenSpaceEventHandler.setInputAction(movement => {
      const picked = viewer.scene.pick(movement.position)
      if (picked?.id?.eyeRecord) select(picked.id.eyeRecord)
    }, Cesium.ScreenSpaceEventType.LEFT_CLICK)
    viewer.camera.changed.addEventListener(() => {
      const c = viewer.camera.positionCartographic
      if (c) $('camera-position').textContent = Cesium.Math.toDegrees(c.latitude).toFixed(1) +
        '° / ' + Cesium.Math.toDegrees(c.longitude).toFixed(1) + '° · ' +
        Math.max(0, c.height / 1000).toFixed(0) + ' km'
    })
    // Actual earth geography, shipped locally with CesiumJS. No Bing/Google/Ion token.
    const imagery = await Cesium.TileMapServiceImageryProvider.fromUrl(
      ROOT + 'cesium/Assets/Textures/NaturalEarthII',
      { maximumLevel: 2 },
    )
    viewer.imageryLayers.addImageryProvider(imagery)
    viewer.scene.requestRender()
  } catch {
    if (state.viewer && !state.viewer.isDestroyed()) {
      try { state.viewer.destroy() } catch { /* clean up partially initialized viewer */ }
    }
    state.viewer = null
    $('fatal').hidden = false
    geoStatus('Fond géographique / WebGL indisponible · liste documentaire seulement')
  }
}

for (const [feed, id] of [['usgs_earthquakes_global_free', 'layer-usgs'], ['gdacs_global_disasters_free', 'layer-gdacs']]) {
  $(id).addEventListener('change', event => {
    if (event.target.checked) state.enabled.add(feed); else state.enabled.delete(feed)
    render()
  })
}
document.querySelectorAll('[data-period]').forEach(button => button.addEventListener('click', () => {
  state.period = button.dataset.period
  document.querySelectorAll('[data-period]').forEach(other =>
    other.setAttribute('aria-pressed', String(other === button)))
  render()
}))
$('refresh').addEventListener('click', readData)
$('home').addEventListener('click', () => state.viewer?.camera.flyHome(1.1))
$('zoom-in').addEventListener('click', () => state.viewer?.camera.zoomIn(1000000))
$('zoom-out').addEventListener('click', () => state.viewer?.camera.zoomOut(1000000))
void startGlobe()
void readData()
