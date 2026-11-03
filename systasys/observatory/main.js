import * as C from 'cesium';
import './style.css';
import { FEEDS } from '../model.js';
import {
  readResource,
  resourceCaption,
  formatTime,
} from '../explorer-model.js';
import { guardCameraAboveGround } from '../../src/cameraGroundGuard.js';
window.CESIUM_BASE_URL = '/cesium/';
const $ = (id) => document.getElementById(id);
const mobile = matchMedia('(max-width:760px)').matches,
  reduced = matchMedia('(prefers-reduced-motion:reduce)').matches;
const PILOT = {
  lat: 46.2019,
  lon: 6.1487,
  bounds: [6.135, 46.195, 6.163, 46.215],
};
const state = {
  viewer: null,
  tiles: null,
  terrainReady: false,
  low: mobile,
  point: { ...PILOT },
  resources: [],
  observations: [],
  readAt: null,
  selected: null,
  all: true,
  placeGeneration: 0,
  observationGeneration: 0,
  flightGeneration: 0,
  mediaGeneration: 0,
  objectUrl: null,
  guard: null,
  paused: false,
  life: new AbortController(),
};
const text = (tag, value, cls) => {
  const e = document.createElement(tag);
  e.textContent = value;
  if (cls) e.className = cls;
  return e;
};
const humanError = () =>
  'Lecture indisponible. Une absence de réponse ne signifie pas une absence de données.';
function drawer(open) {
  $('evidence').classList.toggle('closed', !open);
  $('sources-toggle').setAttribute('aria-expanded', String(open));
}
drawer(!mobile);
$('quality').setAttribute('aria-pressed', String(state.low));
const back = new URL(location.href);
back.port = '';
back.pathname = '/n4/';
back.search = '';
back.hash = '';
$('back-asso').href = back.href;
const today = new Date().toISOString().slice(0, 10);
$('event-day').value = today;
$('event-day').max = today;
$('event-day').min = new Date(Date.now() - 6 * 86400000)
  .toISOString()
  .slice(0, 10);
async function readJson(route, schema, life = state.life) {
  if (!['/api/catalog', '/api/observations'].includes(route))
    throw Error('ROUTE');
  const response = await fetch(route, {
    method: 'GET',
    credentials: 'same-origin',
    redirect: 'error',
    cache: 'no-store',
    signal: AbortSignal.any([life.signal, AbortSignal.timeout(30000)]),
  });
  if (
    !response.ok ||
    !(response.headers.get('content-type') || '').includes('json')
  )
    throw Error('UNAVAILABLE');
  const reader = response.body.getReader();
  let size = 0;
  const chunks = [];
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > 512 * 1024) throw Error('CAP');
      chunks.push(value);
    }
  } finally {
    try {
      await reader.cancel();
    } catch {}
  }
  const bytes = new Uint8Array(size);
  let at = 0;
  for (const c of chunks) {
    bytes.set(c, at);
    at += c.length;
  }
  const value = JSON.parse(
    new TextDecoder('utf-8', { fatal: true }).decode(bytes),
  );
  if (value.schema !== schema || value.read_only !== true)
    throw Error('AUTHORITY');
  return value;
}
async function references() {
  const life = state.life;
  try {
    const value = await readJson(
      '/api/catalog',
      'WORLDS_EYE_OBSERVATORY_CATALOG_V2',
      life,
    );
    if (
      value.pilot.regional_manifest_sha256 !==
      'ec3f49f5459bd18f2c5ab0c6661e733a1ef6a6378883585777807fde1c96379a'
    )
      throw Error('PILOT');
    if (life !== state.life || life.signal.aborted) return;
    $('data-state').textContent =
      'Références officielles · géométrie inchangée';
  } catch {
    if (life !== state.life || life.signal.aborted) return;
    $('data-state').textContent =
      'Références indisponibles · aucune validation affirmée';
  }
}
function clearImage() {
  if (state.objectUrl) URL.revokeObjectURL(state.objectUrl);
  state.objectUrl = null;
  $('resource-image').hidden = true;
  $('resource-image').removeAttribute('src');
  $('media-result').textContent = '';
}
function currentCaption(p) {
  const source = FEEDS[p.source],
    old = Date.now() - Date.parse(p.at) > source.maxFreshMs;
  return `${source.label} · ${old ? 'vieillissant' : 'récent lors de la lecture'} · ${formatTime(p.publishedAt || p.at)}`;
}
function renderEvents() {
  const now = Date.now(),
    day = $('event-day').value;
  const rows = state.observations.filter(
    (p) =>
      now - Date.parse(p.at) <= 7 * 86400000 &&
      (state.all || String(p.publishedAt || p.at).slice(0, 10) === day),
  );
  $('event-count').textContent =
    rows.length + ' observation' + (rows.length === 1 ? '' : 's');
  $('event-list').replaceChildren();
  for (const p of rows.slice(0, 30)) {
    const b = text('button', p.title + ' · ' + currentCaption(p));
    b.type = 'button';
    b.addEventListener('click', () => {
      selectPlace({ lat: p.lat, lon: p.lon }, p.title, false, p);
      state.viewer?.camera.flyTo({
        destination: C.Cartesian3.fromDegrees(p.lon, p.lat, 450000),
        duration: reduced ? 0 : 3,
      });
      drawer(true);
    });
    $('event-list').append(b);
  }
  const viewer = state.viewer;
  if (!viewer) return;
  viewer.entities.values
    .filter((e) => e.eyeObservation)
    .forEach((e) => viewer.entities.remove(e));
  for (const p of rows) {
    const e = viewer.entities.add({
      position: C.Cartesian3.fromDegrees(p.lon, p.lat, 800),
      point: {
        pixelSize: 6,
        color: C.Color.fromCssColorString(FEEDS[p.source].color),
        outlineColor: C.Color.fromCssColorString('#102027'),
        outlineWidth: 1,
        disableDepthTestDistance: Infinity,
      },
    });
    e.eyeObservation = p;
  }
  viewer.scene.requestRender();
}
async function observations() {
  const version = ++state.observationGeneration,
    life = state.life;
  $('refresh').disabled = true;
  $('observations-status').textContent = 'Lecture des observations SPECTRA';
  try {
    const v = await readJson(
      '/api/observations',
      'WORLDS_EYE_OBSERVATIONS_V2',
      life,
    );
    if (version !== state.observationGeneration || life.signal.aborted) return;
    state.observations = v.points;
    state.readAt = v.read_at_utc;
    $('observations-status').textContent =
      `SPECTRA · lu le ${formatTime(v.read_at_utc)} · couverture des seules sources admises`;
    renderEvents();
  } catch {
    if (version !== state.observationGeneration || life.signal.aborted) return;
    state.observations = [];
    $('observations-status').textContent = humanError();
    renderEvents();
  } finally {
    if (version === state.observationGeneration) $('refresh').disabled = false;
  }
}
function selectResource(record) {
  state.selected = record;
  state.mediaGeneration++;
  clearImage();
  $('media-card').hidden = false;
  $('media-title').textContent = record.title || 'Photographie géolocalisée';
  $('media-meta').textContent =
    resourceCaption(record) +
    ' · ' +
    (record.attribution || 'Attribution non fournie');
  $('media-proof').textContent =
    `Reçu ${record.receipt?.receipt_id || 'non fourni'} · ${record.licence || 'Licence non fournie'}`;
  const source = $('media-source');
  source.hidden = true;
  source.removeAttribute('href');
  try {
    const url = new URL(record.source_url);
    if (url.protocol !== 'https:' || url.username || url.password)
      throw Error('URL');
    source.href = url.href;
    source.hidden = false;
  } catch {}
  $('open-media').disabled = !record.media_available;
}
async function discover() {
  const version = ++state.placeGeneration,
    point = { ...state.point };
  state.mediaGeneration++;
  clearImage();
  state.selected = null;
  $('media-card').hidden = true;
  $('local-list').replaceChildren();
  $('discover').disabled = true;
  $('local-status').textContent = 'Lecture des catalogues à proximité';
  try {
    const v = await readResource(
      {
        view: 'nearby',
        lat: point.lat.toFixed(5),
        lon: point.lon.toFixed(5),
        radius: '10',
      },
      false,
      { observatory: true, signal: state.life.signal },
    );
    if (version !== state.placeGeneration) return;
    state.resources = v.records || [];
    const unavailable = Object.values(v.availability || {}).some(
      (x) => x !== 'READ',
    );
    $('local-status').textContent = state.resources.length
      ? `${state.resources.length} ressource(s) publiée(s) à moins de 10 km. Photos historiques ; images de caméras seulement là où le catalogue les fournit.`
      : unavailable
        ? 'Un catalogue n’a pas répondu. La couverture locale reste inconnue.'
        : 'Aucune ressource admise dans les catalogues consultés. Cela ne prouve pas qu’aucune caméra existe ici.';
    for (const r of state.resources) {
      const b = text(
        'button',
        `${r.title || 'Photographie'} · ${r.distance_km} km · ${r.kind === 'HISTORICAL_PHOTO' ? 'archive' : 'caméra publique'}`,
      );
      b.type = 'button';
      b.addEventListener('click', () => selectResource(r));
      $('local-list').append(b);
    }
  } catch {
    if (version === state.placeGeneration)
      $('local-status').textContent = humanError();
  } finally {
    if (version === state.placeGeneration) $('discover').disabled = false;
  }
}
function selectPlace(
  point,
  title = 'Lieu sélectionné',
  read = true,
  observation = null,
) {
  state.point = { lat: point.lat, lon: point.lon };
  state.placeGeneration++;
  state.mediaGeneration++;
  clearImage();
  $('media-card').hidden = true;
  $('local-list').replaceChildren();
  $('place-title').textContent = title;
  $('place-lat').value = String(point.lat.toFixed(5));
  $('place-lon').value = String(point.lon.toFixed(5));
  $('event-evidence').hidden = !observation;
  if (observation) {
    $('event-proof').textContent =
      `${currentCaption(observation)} · reçu ${observation.receipt}`;
    $('event-source').href = observation.url;
  }
  $('place-coordinates').textContent =
    `${point.lat.toFixed(5)}° · ${point.lon.toFixed(5)}°`;
  drawer(true);
  const inside =
    point.lon >= PILOT.bounds[0] &&
    point.lon <= PILOT.bounds[2] &&
    point.lat >= PILOT.bounds[1] &&
    point.lat <= PILOT.bounds[3];
  document.querySelectorAll('.reference-card').forEach((card) => {
    card.hidden = !inside;
  });
  document.querySelector('.place-intro').textContent = inside
    ? 'Données officielles de la zone pilote et observations effectivement disponibles.'
    : 'Les données détaillées de Genève ne couvrent pas ce lieu. Les ressources locales sont recherchées à la demande.';
  if (read) void discover();
  else
    $('local-status').textContent =
      'Rechercher les ressources publiées autour de ce point.';
}
async function openMedia() {
  const r = state.selected;
  if (!r) return;
  const v = ++state.mediaGeneration;
  clearImage();
  $('open-media').disabled = true;
  $('media-result').textContent = 'Lecture de la photographie';
  try {
    const result = await readResource({ view: 'media', id: r.id }, true, {
      observatory: true,
      signal: state.life.signal,
    });
    if (v !== state.mediaGeneration) return;
    state.objectUrl = URL.createObjectURL(result.blob);
    const img = $('resource-image');
    img.src = state.objectUrl;
    img.alt =
      r.kind === 'HISTORICAL_PHOTO'
        ? 'Photographie historique publiée, sans prétention de direct'
        : 'Image publiée par une caméra publique, capture non horodatée';
    await img.decode();
    if (v !== state.mediaGeneration) return;
    if (
      img.naturalWidth > 8192 ||
      img.naturalHeight > 8192 ||
      img.naturalWidth * img.naturalHeight > 16000000
    )
      throw Error('IMAGE_CAP');
    img.hidden = false;
    $('media-result').textContent =
      `${resourceCaption(r)} · SHA256 ${result.sha256 || 'non fourni'}`;
  } catch {
    if (v === state.mediaGeneration) {
      clearImage();
      $('media-result').textContent = humanError();
    }
  } finally {
    $('open-media').disabled = false;
  }
}
async function cityData() {
  const viewer = state.viewer;
  if (!viewer) return;
  if (!state.terrainReady) {
    try {
      const terrain = await C.CesiumTerrainProvider.fromUrl('/tiles/terrain/', {
        requestVertexNormals: true,
        requestWaterMask: false,
      });
      if (viewer !== state.viewer) return;
      viewer.terrainProvider = terrain;
      state.terrainReady = true;
      viewer.scene.requestRender();
    } catch {
      if (viewer !== state.viewer) return;
      $('data-state').textContent =
        'Relief indisponible · la surface plane n’est pas un relief prouvé';
    }
  }
  if (!state.tiles) {
    const tiles = await C.Cesium3DTileset.fromUrl(
      '/tiles/buildings/tileset.json',
      {
        maximumScreenSpaceError: state.low ? 48 : 24,
        cacheBytes: state.low ? 32 * 1024 * 1024 : 64 * 1024 * 1024,
        maximumCacheOverflowBytes: 16 * 1024 * 1024,
        skipLevelOfDetail: true,
      },
    );
    if (viewer !== state.viewer) {
      tiles.destroy();
      return;
    }
    tiles.style = new C.Cesium3DTileStyle({ color: "color('#d8d1bf')" });
    viewer.scene.primitives.add(tiles);
    state.tiles = tiles;
    tiles.loadProgress.addEventListener((pending, processing) => {
      if (viewer !== state.viewer) return;
      $('data-state').textContent =
        pending || processing
          ? `Genève · chargement des volumes (${pending + processing})`
          : state.terrainReady
            ? 'Genève · bâtiments officiels et relief de référence'
            : 'Bâtiments officiels · relief indisponible';
    });
    viewer.scene.requestRender();
  }
  if (viewer === state.viewer && state.tiles)
    $('data-state').textContent =
      'Genève · géométrie officielle en cours de chargement';
}
async function approach() {
  const viewer = state.viewer;
  if (!viewer) return;
  const flight = ++state.flightGeneration;
  $('approach').disabled = true;
  state.guard?.();
  state.guard = null;
  $('scene-kicker').textContent = 'ESPACE → VILLE → LIEU';
  $('scene-title').textContent = 'Genève';
  $('scene-description').textContent =
    'Relief, volumes et orthophotographie de référence. Sélectionner un point pour en lire les sources.';
  document.querySelector('.world').classList.add('city');
  try {
    // Load detailed geometry at arrival, avoiding tiles for intermediate altitudes.
    await Promise.resolve();
  } catch {
    $('data-state').textContent =
      'Modèle 3D indisponible · aucune géométrie de remplacement affirmée';
  }
  if (viewer !== state.viewer || flight !== state.flightGeneration) return;
  viewer.camera.flyToBoundingSphere(
    new C.BoundingSphere(
      C.Cartesian3.fromDegrees(PILOT.lon, PILOT.lat, 385),
      550,
    ),
    {
      duration: reduced ? 0 : 12,
      offset: new C.HeadingPitchRange(
        C.Math.toRadians(315),
        C.Math.toRadians(-35),
        1350,
      ),
      complete: async () => {
        if (viewer !== state.viewer || flight !== state.flightGeneration)
          return;
        state.guard = guardCameraAboveGround(viewer, PILOT);
        $('approach').disabled = false;
        $('approach').firstChild.textContent = 'Recentrer Genève ';
        selectPlace(PILOT, 'Genève', true);
        $('data-state').textContent =
          'Chargement du relief et des bâtiments officiels';
        try {
          await cityData();
        } catch {
          if (viewer === state.viewer)
            $('data-state').textContent =
              'Bâtiments indisponibles · aucune géométrie de remplacement affirmée';
        }
      },
      cancel: () => {
        if (flight === state.flightGeneration) $('approach').disabled = false;
      },
    },
  );
}
async function boot() {
  if (state.viewer) return;
  state.life = new AbortController();
  const life = state.life;
  state.paused = false;
  $('pause').hidden = true;
  state.terrainReady = false;
  state.tiles = null;
  $('fallback').hidden = true;
  $('approach').disabled = false;
  $('discover').disabled = false;
  try {
    const viewer = new C.Viewer('globe', {
      baseLayer: false,
      terrainProvider: new C.EllipsoidTerrainProvider(),
      animation: false,
      timeline: false,
      geocoder: false,
      homeButton: false,
      baseLayerPicker: false,
      sceneModePicker: false,
      navigationHelpButton: false,
      fullscreenButton: false,
      selectionIndicator: false,
      infoBox: false,
      skyBox: false,
      requestRenderMode: true,
      maximumRenderTimeChange: Infinity,
      targetFrameRate: state.low ? 20 : 30,
    });
    state.viewer = viewer;
    viewer.resolutionScale = state.low
      ? 0.75
      : Math.min(devicePixelRatio || 1, 1.25);
    viewer.scene.backgroundColor = C.Color.fromCssColorString('#0b1319');
    viewer.scene.globe.baseColor = C.Color.fromCssColorString('#1c3544');
    viewer.scene.globe.maximumScreenSpaceError = state.low ? 3 : 1.5;
    viewer.scene.globe.preloadAncestors = false;
    viewer.scene.globe.preloadSiblings = false;
    viewer.scene.globe.loadingDescendantLimit = 4;
    viewer.scene.screenSpaceCameraController.minimumZoomDistance = 90;
    viewer.scene.screenSpaceCameraController.maximumZoomDistance = 28e6;
    C.RequestScheduler.maximumRequestsPerServer = 4;
    C.RequestScheduler.maximumRequests = 8;
    viewer.camera.setView({
      destination: C.Cartesian3.fromDegrees(6, 25, 18e6),
    });
    const natural = await C.TileMapServiceImageryProvider.fromUrl(
      '/cesium/Assets/Textures/NaturalEarthII',
      { maximumLevel: 2 },
    );
    if (viewer !== state.viewer) return;
    viewer.imageryLayers.addImageryProvider(natural);
    const aerial = new C.UrlTemplateImageryProvider({
      url: '/tiles/imagery/{z}/{x}/{y}.jpeg',
      tilingScheme: new C.WebMercatorTilingScheme(),
      rectangle: C.Rectangle.fromDegrees(6.1, 46.17, 6.2, 46.24),
      maximumLevel: 18,
      credit: '©swisstopo · SWISSIMAGE, date de capture non fournie',
    });
    viewer.imageryLayers.addImageryProvider(aerial);
    viewer.screenSpaceEventHandler.setInputAction((e) => {
      const pick = viewer.scene.pick(e.position);
      if (pick?.id?.eyeObservation) {
        const p = pick.id.eyeObservation;
        selectPlace(p, p.title, true, p);
        return;
      }
      const ray = viewer.camera.getPickRay(e.position),
        xyz = viewer.scene.globe.pick(ray, viewer.scene);
      if (!xyz) return;
      const p = C.Cartographic.fromCartesian(xyz);
      selectPlace({
        lat: C.Math.toDegrees(p.latitude),
        lon: C.Math.toDegrees(p.longitude),
      });
    }, C.ScreenSpaceEventType.LEFT_CLICK);
    viewer.scene.requestRender();
    void references();
    void observations();
  } catch {
    if (life !== state.life || life.signal.aborted) return;
    $('fallback').hidden = false;
    $('approach').disabled = true;
    void references();
  }
}
function suspend() {
  state.paused = true;
  state.placeGeneration++;
  state.observationGeneration++;
  state.flightGeneration++;
  state.mediaGeneration++;
  state.life.abort();
  state.guard?.();
  state.guard = null;
  clearImage();
  if (state.viewer && !state.viewer.isDestroyed()) state.viewer.destroy();
  state.viewer = null;
  state.tiles = null;
  $('pause').hidden = false;
}
$('approach').addEventListener('click', () => void approach());
$('orbit').addEventListener('click', () => {
  state.flightGeneration++;
  state.guard?.();
  state.guard = null;
  state.viewer?.camera.cancelFlight();
  state.viewer?.camera.flyTo({
    destination: C.Cartesian3.fromDegrees(6, 25, 18e6),
    duration: reduced ? 0 : 3,
  });
  $('approach').disabled = false;
});
$('discover').addEventListener('click', () => void discover());
$('go-place').addEventListener('click', () => {
  const lat = Number($('place-lat').value),
    lon = Number($('place-lon').value);
  if (
    !$('place-lat').value.trim() ||
    !$('place-lon').value.trim() ||
    !Number.isFinite(lat) ||
    !Number.isFinite(lon) ||
    Math.abs(lat) > 90 ||
    Math.abs(lon) > 180
  ) {
    $('local-status').textContent =
      'Renseigner une latitude entre −90 et 90 et une longitude entre −180 et 180.';
    return;
  }
  selectPlace({ lat, lon });
  state.viewer?.camera.flyTo({
    destination: C.Cartesian3.fromDegrees(lon, lat, 25000),
    duration: reduced ? 0 : 3,
  });
});
$('open-media').addEventListener('click', () => void openMedia());
$('refresh').addEventListener('click', () => void observations());
$('sources-toggle').addEventListener('click', () =>
  drawer($('evidence').classList.contains('closed')),
);
$('sources-close').addEventListener('click', () => {
  drawer(false);
  $('sources-toggle').focus();
});
$('open-place').addEventListener('click', () => drawer(true));
$('quality').addEventListener('click', () => {
  state.low = !state.low;
  $('quality').setAttribute('aria-pressed', String(state.low));
  if (state.viewer) {
    state.viewer.resolutionScale = state.low
      ? 0.75
      : Math.min(devicePixelRatio || 1, 1.25);
    if (state.tiles) state.tiles.maximumScreenSpaceError = state.low ? 48 : 24;
    state.viewer.scene.requestRender();
  }
});
$('zoom-in').addEventListener('click', () => {
  const v = state.viewer;
  if (v)
    v.camera.zoomIn(Math.max(40, v.camera.positionCartographic.height * 0.45));
});
$('zoom-out').addEventListener('click', () => {
  const v = state.viewer;
  if (v)
    v.camera.zoomOut(Math.max(40, v.camera.positionCartographic.height * 0.65));
});
$('show-all').addEventListener('click', () => {
  state.all = true;
  $('show-all').setAttribute('aria-pressed', 'true');
  renderEvents();
});
$('event-day').addEventListener('change', () => {
  state.all = false;
  $('show-all').setAttribute('aria-pressed', 'false');
  renderEvents();
});
$('resume').addEventListener('click', () => void boot());
document.addEventListener('visibilitychange', () => {
  if (document.hidden) suspend();
});
window.addEventListener('pagehide', suspend);
window.addEventListener('focus', () => {
  if (!state.paused) renderEvents();
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    state.flightGeneration++;
    state.viewer?.camera.cancelFlight();
    $('approach').disabled = false;
    if (mobile) drawer(false);
  }
});
void boot();
