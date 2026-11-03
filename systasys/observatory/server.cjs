'use strict';
// One unprivileged read gateway. Fixed public geodata + existing SPECTRA
// contracts; no second collector, causal store, credentials or generic proxy.
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { setTimeout: delay } = require('node:timers/promises');
const CORE = 'http://127.0.0.1:5198/n4/api/asso/spectra/';
const BUILDINGS =
  'https://3d.geo.admin.ch/ch.swisstopo.swissbuildings3d.3d/v1/20260520/';
const TERRAIN = 'https://3d.geo.admin.ch/ch.swisstopo.terrain.3d/v1/20250101/';
const IMAGERY =
  'https://wmts.geo.admin.ch/1.0.0/ch.swisstopo.swissimage/default/current/3857/';
const ROOT = path.join(__dirname, 'dist');
const hash = (b) => crypto.createHash('sha256').update(b).digest('hex');
const CSP =
  "default-src 'none'; script-src 'self' 'unsafe-eval'; style-src 'self' 'unsafe-inline'; connect-src 'self' blob:; img-src 'self' blob: data:; font-src 'self'; worker-src 'self' blob:; media-src 'self' blob:; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
  '.wasm': 'application/wasm',
};
class Refusal extends Error {
  constructor(code, status = 400) {
    super(code);
    this.status = status;
  }
}
function imageType(b) {
  let type, width, height;
  if (
    b.length >= 24 &&
    b.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) &&
    b.toString('ascii', 12, 16) === 'IHDR'
  ) {
    type = 'image/png';
    width = b.readUInt32BE(16);
    height = b.readUInt32BE(20);
  } else if (b[0] === 255 && b[1] === 216 && b[2] === 255) {
    for (let at = 2; at + 4 <= b.length;) {
      if (b[at++] !== 255) return null;
      while (b[at] === 255) at++;
      const marker = b[at++];
      if (marker === 0xda || marker === 0xd9) break;
      if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
      if (at + 2 > b.length) return null;
      const size = b.readUInt16BE(at);
      if (size < 2 || at + size > b.length) return null;
      if (
        [
          0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd,
          0xce, 0xcf,
        ].includes(marker)
      ) {
        if (size < 8) return null;
        type = 'image/jpeg';
        height = b.readUInt16BE(at + 3);
        width = b.readUInt16BE(at + 5);
        break;
      }
      at += size;
    }
  }
  return width > 0 &&
    height > 0 &&
    width <= 8192 &&
    height <= 8192 &&
    width * height <= 16000000
    ? type
    : null;
}
function resourceQuery(url) {
  if (url.search.length > 500) throw new Refusal('QUERY_CAP');
  const q = url.searchParams,
    view = q.get('view');
  const views = {
    catalog: ['view'],
    nearby: ['view', 'lat', 'lon', 'radius'],
    cameras: ['view'],
    media: ['view', 'id'],
    imagery: ['view', 'lat', 'lon', 'day'],
    satellites: ['view'],
    alerts: ['view'],
  };
  const keys = Object.hasOwn(views, view) ? views[view] : null;
  if (
    !keys ||
    [...q.keys()].some((k) => !keys.includes(k) || q.getAll(k).length !== 1)
  )
    throw new Refusal('QUERY_REFUSED');
  // The existing reader applies its own source/coordinate/licence/date gates.
  return q.toString();
}
function createGateway({
  root = ROOT,
  fetchImpl = fetch,
  normalize,
  bytesPerSecond = 2 * 1024 * 1024,
} = {}) {
  root = fs.realpathSync(root);
  const manifest = JSON.parse(
    fs.readFileSync(path.join(root, 'MANIFEST.json')),
  );
  const staticManifestSha = hash(
    fs.readFileSync(path.join(root, 'MANIFEST.json')),
  );
  const gatewaySha = hash(fs.readFileSync(__filename));
  const derivation = JSON.parse(
    fs.readFileSync(path.join(root, 'pilot/buildings/SOURCE_RECEIPT.json')),
  );
  const regional = fs.readFileSync(
    path.join(root, 'pilot/buildings/tileset.json'),
  );
  if (
    derivation.publication_revision !== '20260520' ||
    hash(regional) !== derivation.regional_manifest_sha256 ||
    derivation.admitted_content_count > 256
  )
    throw Error('PILOT_IDENTITY_REFUSED');
  const admitted = new Set(derivation.admitted_content_paths);
  if (
    admitted.size !== derivation.admitted_content_count ||
    [...admitted].some((p) => !/^\d{1,2}\/\d{1,6}\/\d{1,6}\.b3dm$/.test(p))
  )
    throw Error('PILOT_PATHS_REFUSED');
  const entries = manifest.entries;
  if (
    manifest.schema !== 'SYSTASYS_WORLDS_EYE_OBSERVATORY_BUNDLE_V2' ||
    !/^[a-f0-9]{40}$/.test(manifest.source_sha) ||
    !entries ||
    Object.keys(entries).some(
      (p) =>
        !/^[A-Za-z0-9_./-]+$/.test(p) ||
        p.split('/').some((v) => ['', '.', '..'].includes(v)) ||
        !Number.isSafeInteger(entries[p]?.size) ||
        entries[p].size < 0 ||
        entries[p].size > 8 * 1024 * 1024 ||
        !/^[a-f0-9]{64}$/.test(entries[p]?.sha256),
    )
  )
    throw Error('BUNDLE_PATHS_REFUSED');
  let active = 0,
    responses = 0,
    cacheBytes = 0,
    sourceRequests = [],
    outputAt = 0;
  const queue = [],
    cache = new Map(),
    started = Date.now();
  const counters = { upstream_reads: 0, served_bytes: 0, refused_reads: 0 };
  async function permit(signal) {
    signal.throwIfAborted();
    if (active < 4) {
      active++;
      return;
    }
    if (queue.length >= 16) throw new Refusal('BACKPRESSURE', 429);
    await new Promise((resolve, reject) => {
      const item = {
        done: () => {
          clearTimeout(timer);
          signal.removeEventListener('abort', abort);
          resolve();
        },
      };
      const remove = (error) => {
        const i = queue.indexOf(item);
        if (i >= 0) queue.splice(i, 1);
        clearTimeout(timer);
        signal.removeEventListener('abort', abort);
        reject(error);
      };
      const abort = () => remove(new Refusal('CANCELLED', 499));
      const timer = setTimeout(
        () => remove(new Refusal('QUEUE_TIMEOUT', 503)),
        8000,
      );
      signal.addEventListener('abort', abort, { once: true });
      queue.push(item);
    });
  }
  function release() {
    const next = queue.shift();
    if (next) next.done();
    else active--;
  }
  // One body-byte budget for source reads and client output. Waiting exists
  // only while an admitted request is active; there is no idle refill timer.
  async function paceBody(size, signal) {
    for (let remaining = size; remaining > 0; remaining -= 65536) {
      signal.throwIfAborted();
      const amount = Math.min(remaining, 65536);
      const wait = Math.max(0, outputAt - performance.now());
      outputAt =
        Math.max(performance.now(), outputAt) +
        (amount / bytesPerSecond) * 1000;
      if (wait) await delay(wait, undefined, { signal });
    }
  }
  async function upstream(url, cap, signal, ttl = 600000) {
    const previous = cache.get(url);
    if (previous && previous.until > Date.now()) return previous;
    if (previous) {
      cache.delete(url);
      cacheBytes -= previous.bytes.length;
    }
    await permit(signal);
    const controller = new AbortController(),
      stop = () => controller.abort(),
      timer = setTimeout(stop, 18000);
    signal.addEventListener('abort', stop, { once: true });
    let reader;
    try {
      signal.throwIfAborted();
      sourceRequests = sourceRequests.filter((t) => Date.now() - t < 60000);
      if (sourceRequests.length >= 512) throw new Refusal('READ_BUDGET', 429);
      sourceRequests.push(Date.now());
      counters.upstream_reads++;
      const response = await fetchImpl(url, {
        method: 'GET',
        redirect: 'error',
        signal: controller.signal,
        headers: {
          Accept:
            url.startsWith(TERRAIN) && /\.terrain\?v=1\.43646\.0$/.test(url)
              ? 'application/vnd.quantized-mesh;extensions=octvertexnormals-metadata'
              : 'application/json,application/octet-stream,image/jpeg,image/png',
          'User-Agent': 'SYSTASYS-WorldsEye/2.0 (+https://hichembenali.com)',
        },
      });
      if (!response.ok || response.redirected)
        throw new Refusal(
          'SOURCE_UNAVAILABLE',
          response.status === 404 ? 404 : 503,
        );
      if (Number(response.headers.get('content-length') || 0) > cap)
        throw new Refusal('SOURCE_CAP', 502);
      reader = response.body?.getReader();
      if (!reader) throw new Refusal('SOURCE_BODY_MISSING', 502);
      const chunks = [];
      let size = 0;
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > cap) throw new Refusal('SOURCE_CAP', 502);
        await paceBody(value.byteLength, controller.signal);
        chunks.push(Buffer.from(value));
      }
      const bytes = Buffer.concat(chunks);
      const result = {
        bytes,
        type:
          response.headers.get('content-type') || 'application/octet-stream',
        readAt: new Date().toISOString(),
        sha256: hash(bytes),
        until: Date.now() + ttl,
        imageSha: response.headers.get('x-worldseye-image-sha256'),
        imageReadAt: response.headers.get('x-worldseye-retrieved-at'),
        imageDay: response.headers.get('x-worldseye-imagery-day'),
      };
      if (ttl > 0) {
        while (
          cache.size &&
          (cache.size >= 512 || cacheBytes + size > 64 * 1024 * 1024)
        ) {
          const [key, item] = cache.entries().next().value;
          cache.delete(key);
          cacheBytes -= item.bytes.length;
        }
        if (size <= 4 * 1024 * 1024) {
          cache.set(url, result);
          cacheBytes += size;
        }
      }
      return result;
    } finally {
      clearTimeout(timer);
      controller.abort();
      signal.removeEventListener('abort', stop);
      if (reader) {
        try {
          Promise.resolve(reader.cancel()).catch(() => {});
        } catch {}
      }
      release();
    }
  }
  async function send(res, bytes, type, signal, headers = {}) {
    res.writeHead(200, {
      'Content-Type': type,
      'Content-Length': bytes.length,
      'Cache-Control': 'no-store',
      ...headers,
    });
    for (let i = 0; i < bytes.length; i += 65536) {
      signal.throwIfAborted();
      const chunk = bytes.subarray(i, i + 65536);
      await paceBody(chunk.length, signal);
      if (res.destroyed) return;
      if (!res.write(chunk))
        await new Promise((resolve, reject) => {
          const clean = () => {
            res.off('drain', drain);
            res.off('close', close);
          };
          const drain = () => {
            clean();
            resolve();
          };
          const close = () => {
            clean();
            reject(new Refusal('CANCELLED', 499));
          };
          res.once('drain', drain);
          res.once('close', close);
        });
      counters.served_bytes += chunk.length;
    }
    res.end();
  }
  const server = http.createServer(async (req, res) => {
    const controller = new AbortController(),
      signal = controller.signal;
    res.on('close', () => controller.abort());
    for (const [k, v] of Object.entries({
      'Content-Security-Policy': CSP,
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'no-referrer',
      'Cross-Origin-Resource-Policy': 'same-origin',
      'Cross-Origin-Opener-Policy': 'same-origin',
      'X-Frame-Options': 'DENY',
    }))
      res.setHeader(k, v);
    if (responses >= 8) {
      counters.refused_reads++;
      res.writeHead(429, {
        'Content-Type': 'application/json',
        'Retry-After': '2',
        'Cache-Control': 'no-store',
      });
      return res.end(
        JSON.stringify({ error: 'RESPONSE_BUDGET', read_only: true }),
      );
    }
    responses++;
    const deadline = setTimeout(() => {
      controller.abort();
      res.destroy();
    }, 35000);
    try {
      if (req.method !== 'GET')
        throw new Refusal('READ_ONLY_GET_REQUIRED', 405);
      const url = new URL(req.url, 'http://127.0.0.1'),
        p = url.pathname;
      const json = (value) =>
        send(
          res,
          Buffer.from(JSON.stringify(value)),
          'application/json; charset=utf-8',
          signal,
        );
      if (p === '/api/health' && !url.search)
        return await json({
          schema: 'WORLDS_EYE_OBSERVATORY_HEALTH_V2',
          source_repository: 'monkidy/gods-eye-view',
          source_sha: manifest.source_sha,
          static_manifest_sha256: staticManifestSha,
          gateway_sha256: gatewaySha,
          build_scope: manifest.build_scope,
          working_tree_dirty: manifest.working_tree_dirty,
          read_only: true,
          pid: process.pid,
          uptime_seconds: Math.floor((Date.now() - started) / 1000),
          active,
          active_responses: responses,
          queued: queue.length,
          cache_bytes: cacheBytes,
          ...counters,
        });
      if (p === '/api/catalog' && !url.search)
        return await json({
          schema: 'WORLDS_EYE_OBSERVATORY_CATALOG_V2',
          pilot: derivation,
          read_only: true,
          imagery_capture_at_utc: null,
          terrain_publication: '20250101',
          background_collection: false,
        });
      if (p === '/api/observations' && !url.search) {
        const r = await upstream(CORE + 'war-room', 1048576, signal, 5000);
        const normalized = normalize(JSON.parse(r.bytes));
        return await json({
          schema: 'WORLDS_EYE_OBSERVATIONS_V2',
          ...normalized,
          read_at_utc: r.readAt,
          read_only: true,
        });
      }
      if (p === '/api/resources') {
        const q = resourceQuery(url),
          r = await upstream(
            CORE + 'geospatial?' + q,
            3 * 1024 * 1024,
            signal,
            0,
          );
        if (!r.type.includes('json') && !imageType(r.bytes))
          throw new Refusal('MEDIA_FORMAT', 502);
        return await send(
          res,
          r.bytes,
          r.type.includes('json') ? 'application/json' : imageType(r.bytes),
          signal,
          r.imageSha
            ? {
                'X-Worldseye-Image-SHA256': r.imageSha,
                'X-Worldseye-Retrieved-At': r.imageReadAt || '',
                'X-Worldseye-Imagery-Day': r.imageDay || '',
              }
            : {},
        );
      }
      let source,
        cap = 2 * 1024 * 1024,
        type;
      if (p === '/tiles/buildings/tileset.json' && !url.search)
        return await send(res, regional, 'application/json', signal);
      if (
        p.startsWith('/tiles/buildings/') &&
        !url.search &&
        admitted.has(p.slice(17))
      ) {
        source = BUILDINGS + p.slice(17);
        type = 'application/octet-stream';
      }
      if (p === '/tiles/terrain/layer.json' && !url.search) {
        source = TERRAIN + 'layer.json';
        type = 'application/json';
        cap = 65536;
      }
      const terrain =
        /^\/tiles\/terrain\/(\d{1,2})\/(\d{1,6})\/(\d{1,6})\.terrain$/.exec(p);
      if (
        terrain &&
        [...url.searchParams.keys()].every((k) => k === 'v') &&
        url.searchParams.getAll('v').length === 1 &&
        url.searchParams.get('v') === '1.43646.0'
      ) {
        const [z, x, y] = terrain.slice(1).map(Number);
        if (z <= 16 && x < 2 ** (z + 1) && y < 2 ** z) {
          source = TERRAIN + `${z}/${x}/${y}.terrain?v=1.43646.0`;
          type = 'application/vnd.quantized-mesh';
        }
      }
      const imagery =
        /^\/tiles\/imagery\/(\d{1,2})\/(\d{1,6})\/(\d{1,6})\.jpeg$/.exec(p);
      if (imagery && !url.search) {
        const [z, x, y] = imagery.slice(1).map(Number);
        if (z <= 18 && x < 2 ** z && y < 2 ** z) {
          source = IMAGERY + `${z}/${x}/${y}.jpeg`;
          type = 'image/jpeg';
          cap = 1048576;
        }
      }
      if (source) {
        const r = await upstream(source, cap, signal);
        if (
          source.startsWith(BUILDINGS) &&
          (r.bytes.length < 28 ||
            r.bytes.toString('ascii', 0, 4) !== 'b3dm' ||
            r.bytes.readUInt32LE(8) !== r.bytes.length)
        )
          throw new Refusal('TILE_FORMAT', 502);
        if (type === 'image/jpeg' && imageType(r.bytes) !== 'image/jpeg')
          throw new Refusal('IMAGE_FORMAT', 502);
        if (p === '/tiles/terrain/layer.json') {
          const layer = JSON.parse(r.bytes);
          layer.maxzoom = Math.min(16, layer.maxzoom);
          layer.attribution = '©swisstopo';
          return await json(layer);
        }
        return await send(res, r.bytes, type, signal, {
          'X-Worldseye-Source-SHA256': r.sha256,
          'X-Worldseye-Read-At': r.readAt,
        });
      }
      if (p.startsWith('/tiles/') || p.startsWith('/api/') || url.search)
        throw new Refusal('NOT_ADMITTED', 404);
      const name = p === '/' ? 'index.html' : p.slice(1),
        entry = Object.hasOwn(entries, name) ? entries[name] : null;
      if (!entry) throw new Refusal('NOT_FOUND', 404);
      const file = path.join(root, name);
      if (!fs.realpathSync(file).startsWith(root + path.sep))
        throw new Refusal('STATIC_PATH', 404);
      const bytes = await fs.promises.readFile(file);
      if (bytes.length !== entry.size || hash(bytes) !== entry.sha256)
        throw new Refusal('STATIC_IDENTITY', 503);
      return await send(
        res,
        bytes,
        MIME[path.extname(name)] || 'application/octet-stream',
        signal,
        {
          'Cache-Control': /-[A-Za-z0-9_-]{6,}\./.test(name)
            ? 'private,max-age=31536000,immutable'
            : 'no-store',
        },
      );
    } catch (e) {
      counters.refused_reads++;
      if (res.destroyed) return;
      if (res.headersSent) return res.destroy();
      res.writeHead(e instanceof Refusal ? e.status : 503, {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-store',
      });
      res.end(
        JSON.stringify({
          error: e instanceof Refusal ? e.message : 'RESOURCE_UNAVAILABLE',
          read_only: true,
        }),
      );
    } finally {
      clearTimeout(deadline);
      controller.abort();
      responses--;
    }
  });
  server.requestTimeout = 30000;
  server.headersTimeout = 10000;
  server.maxConnections = 64;
  return server;
}
module.exports = { createGateway, resourceQuery, imageType, Refusal, CSP };
