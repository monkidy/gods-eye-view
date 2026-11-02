import { readResource, validPlace, satellitePosition, resourceCaption, formatTime } from './explorer-model.js'

export function createExplorer(C) {
  const $ = id => document.getElementById(id)
  let viewer, place, nearbyGeneration = 0, mediaGeneration = 0, mediaUrl, moveTimer, lastAuto = 0, lastSatellite = 0
  const sources = new Map(), layers = new Map(), busy = new Set()
  const message = value => { $('local-status').textContent = value }
  $('toggle-layers').addEventListener('click', () => {
    const open = $('toggle-layers').getAttribute('aria-expanded') !== 'true'
    $('toggle-layers').setAttribute('aria-expanded', String(open)); $('eye-app').dataset.layersOpen = String(open)
  })
  $('resource-image').addEventListener('load', () => $('resource-image').scrollIntoView({ block: 'center' }))
  function tab(name) {
    for (const id of ['observations', 'local']) {
      $('panel-' + id).hidden = id !== name
      $('tab-' + id).setAttribute('aria-selected', String(id === name))
    }
  }
  for (const name of ['observations', 'local']) $('tab-' + name).addEventListener('click', () => tab(name))
  function clearMedia() {
    mediaGeneration++
    $('resource-image').removeAttribute('src'); $('resource-image').hidden = true
    if (mediaUrl) URL.revokeObjectURL(mediaUrl)
    mediaUrl = null; $('media-caption').textContent = ''
  }
  function sourceLink(item) {
    const link = $('resource-source')
    try {
      const url = new URL(item.source_url)
      if (url.protocol !== 'https:') throw Error()
      link.href = url.href; link.hidden = false
    } catch { link.hidden = true; link.removeAttribute('href') }
  }
  function selectResource(item) {
    tab('local'); clearMedia()
    $('resource-card').hidden = false
    $('resource-title').textContent = item.title
    $('resource-meta').textContent = resourceCaption(item) + '\n' + item.attribution +
      (item.licence ? ' · ' + item.licence : '') + '\nReçu ' + item.receipt.receipt_id
    $('resource-description').textContent = item.description || (item.kind === 'CAMERA_SNAPSHOT'
      ? 'Image publique à la demande. Le fournisseur ne certifie pas ici l’heure de prise de vue. Aucun direct vidéo affirmé.'
      : item.kind === 'HISTORICAL_PHOTO' ? 'Photographie datée, parfois panoramique. Elle ne décrit pas la situation actuelle.'
      : item.kind === 'ORBITAL_ELEMENTS' ? 'Position estimée à partir des éléments orbitaux, pas une observation optique en direct.' : 'Zone publiée par NOAA. La couverture de cette couche est limitée aux États-Unis et territoires.')
    sourceLink(item)
    const button = $('open-media'); button.hidden = !item.media_available
    button.disabled = false
    button.onclick = () => void openImage({ view: 'media', id: item.id }, resourceCaption(item) + ' · ' + item.attribution + ' · ' + item.licence, button)
    $('resource-card').scrollIntoView({ block: 'start' })
  }
  async function openImage(params, caption, button) {
    clearMedia(); const generation = mediaGeneration
    button.disabled = true; $('media-caption').textContent = 'Lecture de l’image…'
    try {
      const image = await readResource(params, true)
      if (generation !== mediaGeneration) return
      mediaUrl = URL.createObjectURL(image.blob)
      $('resource-image').src = mediaUrl; $('resource-image').hidden = false
      $('resource-image').alt = caption
      $('media-caption').textContent = caption + ' · image lue le ' + formatTime(image.readAt) +
        (image.day ? ' · mosaïque du ' + image.day + ' (UTC)' : '') + ' · SHA-256 ' + image.sha256
    } catch (error) {
      if (generation === mediaGeneration) $('media-caption').textContent =
        ['NO_IMAGERY_COVERAGE', 'IMAGERY_COVERAGE_UNPROVEN'].includes(error.message)
          ? 'Aucune image confirmée pour cette zone et cette date.'
          : 'Image indisponible (' + error.message + '). Aucune image de remplacement présentée.'
    } finally { button.disabled = false }
  }
  function dataSource(name) {
    if (!viewer) return null
    if (!sources.has(name)) {
      const ds = new C.CustomDataSource('WorldsEye:' + name)
      sources.set(name, ds); viewer.dataSources.add(ds)
    }
    return sources.get(name)
  }
  function draw(name, records) {
    const ds = dataSource(name)
    if (!ds) return
    ds.entities.removeAll()
    const color = { cameras: '#69d2c0', nearby: '#e7ca7b', satellites: '#91b9ff', alerts: '#f28b84' }[name]
    for (const item of records) {
      if (item.kind === 'WEATHER_ALERT_AREA' && Date.parse(item.expires_at_utc) <= Date.now()) continue
      if (item.paths) {
        for (const [i, ring] of item.paths.entries()) {
          const e = ds.entities.add({ id: item.id + ':' + i, polyline: { positions: C.Cartesian3.fromDegreesArray(ring.flat()), width: 2, material: C.Color.fromCssColorString(color) } })
          e.eyeResource = item
        }
      } else {
        const p = item.kind === 'ORBITAL_ELEMENTS' ? satellitePosition(item) : item
        if (!p || !validPlace(p.lat, p.lon)) continue
        const e = ds.entities.add({ id: item.id, name: item.title, position: C.Cartesian3.fromDegrees(p.lon, p.lat, p.height || 0),
          point: { pixelSize: name === 'cameras' ? 5 : 9, color: C.Color.fromCssColorString(color),
            outlineColor: C.Color.WHITE, outlineWidth: 1, disableDepthTestDistance: Infinity } })
        e.eyeResource = item
      }
    }
    ds.show = name === 'nearby' || $('layer-' + name).checked
    viewer.scene.requestRender()
  }
  for (const name of ['cameras', 'satellites', 'alerts']) {
    $('layer-' + name).addEventListener('change', async event => {
      if (!event.target.checked) { const ds = sources.get(name); if (ds) ds.show = false; viewer?.scene.requestRender(); return }
      if (busy.has(name)) return
      busy.add(name); $('count-' + name).textContent = '…'
      try {
        const data = await readResource({ view: name })
        layers.set(name, data.records); draw(name, data.records)
        $('count-' + name).textContent = String(data.records.length) + (data.truncated ? '+' : '')
        $('layer-status-' + name).textContent = 'Lu le ' + formatTime(data.receipt.retrieved_at_utc)
      } catch (error) {
        layers.delete(name); draw(name, []); event.target.checked = false
        $('count-' + name).textContent = '—'; $('layer-status-' + name).textContent = 'Indisponible · ' + error.message
      } finally { busy.delete(name) }
    })
  }
  async function discover() {
    if (!place) return message('Choisis un lieu sur le globe ou saisis ses coordonnées.')
    const generation = ++nearbyGeneration, query = { ...place }
    clearMedia(); $('local-results').replaceChildren(); $('resource-title').textContent = 'Ressources autour du lieu'
    $('resource-card').hidden = true
    $('resource-meta').textContent = ''; $('resource-description').textContent = ''
    $('resource-source').hidden = true; $('resource-source').removeAttribute('href'); $('open-media').hidden = true
    draw('nearby', []); $('discover').disabled = true
    message('Recherche dans les catalogues publics · rayon 10 km…')
    try {
      const data = await readResource({ view: 'nearby', lat: query.lat.toFixed(5), lon: query.lon.toFixed(5), radius: 10 })
      if (generation !== nearbyGeneration) return
      const records = data.records
      draw('nearby', records)
      for (const item of records) {
        const b = document.createElement('button'); b.type = 'button'
        b.textContent = (item.kind === 'CAMERA_SNAPSHOT' ? '◉ Caméra · ' : '▧ Photo datée · ') + item.title + ' · ' + item.distance_km + ' km'
        b.addEventListener('click', () => selectResource(item)); $('local-results').append(b)
      }
      const unavailable = Object.entries(data.availability).filter(([, value]) => value !== 'READ').map(([key]) => key)
      const cameras = records.filter(r => r.kind === 'CAMERA_SNAPSHOT').length
      message(records.length + ' ressource(s) trouvée(s)' + (data.truncated ? ' (sélection limitée)' : '') + ' · ' +
        (data.availability.vegvesen !== 'READ' ? 'catalogue de caméras inaccessible' : cameras ? cameras + ' caméra(s) publique(s)' : 'aucune caméra trouvée dans le catalogue norvégien consulté') +
        (unavailable.length ? ' · source inaccessible : ' + unavailable.join(', ') : '') + '. Photos Panoramax historiques. Aucune vidéo automatique.')
    } catch (error) { if (generation === nearbyGeneration) message('Recherche indisponible · ' + error.message) }
    finally { if (generation === nearbyGeneration) $('discover').disabled = false }
  }
  function selectPlace(lat, lon, { fly = false, lookup = true } = {}) {
    if (!validPlace(lat, lon)) return message('Coordonnées invalides : latitude −90 à 90, longitude −180 à 180.')
    place = { lat, lon }; $('place-lat').value = lat.toFixed(5); $('place-lon').value = lon.toFixed(5)
    $('place-name').textContent = lat.toFixed(4) + '° / ' + lon.toFixed(4) + '°'; tab('local')
    if (fly && viewer) viewer.camera.flyTo({ destination: C.Cartesian3.fromDegrees(lon, lat, 45000), duration: 1.1 })
    if (lookup) void discover()
  }
  $('place-form').addEventListener('submit', event => {
    event.preventDefault()
    const lat = $('place-lat').value.trim(), lon = $('place-lon').value.trim()
    if (!lat || !lon) return message('Renseigne les deux coordonnées.')
    selectPlace(Number(lat), Number(lon), { fly: true })
  })
  document.querySelectorAll('[data-place]').forEach(button => button.addEventListener('click', () => {
    const [lat, lon] = button.dataset.place.split(',').map(Number); selectPlace(lat, lon, { fly: true })
  }))
  $('discover').addEventListener('click', () => void discover())
  const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10)
  $('imagery-day').value = yesterday; $('imagery-day').max = yesterday
  $('imagery-day').min = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10)
  $('open-imagery').addEventListener('click', () => {
    if (!place) return message('Choisis d’abord un lieu pour l’image satellite.')
    $('resource-card').hidden = false
    $('resource-title').textContent = 'VIIRS NOAA-21 · NASA Worldview'
    $('resource-meta').textContent = 'Mosaïque quotidienne · environ 250 m/pixel · nuages possibles · pas de direct ni de détail de rue.'
    $('resource-description').textContent = ''; $('open-media').hidden = true
    sourceLink({ source_url: 'https://worldview.earthdata.nasa.gov/' })
    $('resource-card').scrollIntoView({ block: 'start' })
    void openImage({ view: 'imagery', lat: place.lat.toFixed(5), lon: place.lon.toFixed(5), day: $('imagery-day').value },
      'NASA GIBS / VIIRS NOAA-21 · mosaïque quotidienne · date du produit, heure exacte de prise de vue non fournie', $('open-imagery'))
  })
  function attach(v) {
    viewer = v
    for (const [name, records] of layers) draw(name, records)
    viewer.camera.moveEnd.addEventListener(() => {
      clearTimeout(moveTimer)
      if (viewer.camera.positionCartographic.height > 150000) return
      moveTimer = setTimeout(() => {
        if (Date.now() - lastAuto < 10000 || busy.size) return
        const canvas = viewer.scene.canvas
        const p = viewer.camera.pickEllipsoid(new C.Cartesian2(canvas.clientWidth / 2, canvas.clientHeight / 2), viewer.scene.globe.ellipsoid)
        if (!p) return
        const cart = C.Cartographic.fromCartesian(p), lat = C.Math.toDegrees(cart.latitude), lon = C.Math.toDegrees(cart.longitude)
        if (place && Math.abs(place.lat - lat) + Math.abs(place.lon - lon) < 0.03) return
        lastAuto = Date.now(); selectPlace(lat, lon)
      }, 800)
    })
    viewer.clock.onTick.addEventListener(() => {
      if (Date.now() - lastSatellite < 10000) return
      lastSatellite = Date.now()
      if ($('layer-satellites').checked && layers.has('satellites')) draw('satellites', layers.get('satellites'))
      // Expired weather geometries are removed even while the network is idle.
      if ($('layer-alerts').checked && layers.has('alerts')) draw('alerts', layers.get('alerts'))
    })
  }
  function pick(picked, screenPosition) {
    if (picked?.id?.eyeResource) { selectResource(picked.id.eyeResource); return }
    const p = viewer.camera.pickEllipsoid(screenPosition, viewer.scene.globe.ellipsoid)
    if (p) { const geo = C.Cartographic.fromCartesian(p); selectPlace(C.Math.toDegrees(geo.latitude), C.Math.toDegrees(geo.longitude)) }
  }
  return { attach, pick, selectPlace }
}
