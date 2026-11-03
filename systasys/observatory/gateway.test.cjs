'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { createGateway, resourceQuery, imageType } = require(
  process.env.WORLDS_EYE_GATEWAY_MODULE || './server.cjs',
);
const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');
const app = process.env.WORLDS_EYE_TEST_BUNDLE || path.join(__dirname, 'dist');
async function fixture(
  t,
  fetchImpl = async () => {
    throw Error('unexpected upstream');
  },
) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'worlds-eye-v2-test-'));
  fs.mkdirSync(path.join(root, 'pilot/buildings'), { recursive: true });
  for (const name of ['tileset.json', 'SOURCE_RECEIPT.json'])
    fs.copyFileSync(
      path.join(app, 'pilot/buildings', name),
      path.join(root, 'pilot/buildings', name),
    );
  const html = Buffer.from(
    '<!doctype html><title>isolated proof fixture</title>',
  );
  fs.writeFileSync(path.join(root, 'index.html'), html);
  fs.writeFileSync(
    path.join(root, 'MANIFEST.json'),
    JSON.stringify({
      schema: 'SYSTASYS_WORLDS_EYE_OBSERVATORY_BUNDLE_V2',
      source_sha: 'a'.repeat(40),
      entries: { 'index.html': { size: html.length, sha256: sha(html) } },
    }),
  );
  const server = createGateway({
    root,
    fetchImpl,
    normalize: () => ({ points: [], total: 1 }),
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
    fs.rmSync(root, { recursive: true, force: true });
  });
  return { root, server, base: `http://127.0.0.1:${server.address().port}` };
}
test('only fixed read views are admitted; duplicates, arbitrary URL and prototype names never reach an upstream', async (t) => {
  const { base } = await fixture(t);
  for (const query of [
    'view=nearby&url=https://evil.test',
    'view=media&id=x&id=y',
    'view=toString',
    'view=__proto__',
  ]) {
    assert.throws(() =>
      resourceQuery(new URL(base + '/api/resources?' + query)),
    );
    assert.equal((await fetch(base + '/api/resources?' + query)).status, 400);
  }
  assert.equal(
    (await fetch(base + '/api/catalog', { method: 'POST' })).status,
    405,
  );
  assert.equal((await fetch(base + '/api/catalog?url=x')).status, 404);
});
test('the independent origin refuses framing and external connections; absent assets never become HTML success', async (t) => {
  const { base } = await fixture(t);
  const r = await fetch(base + '/');
  assert.equal(r.status, 200);
  assert.match(
    r.headers.get('content-security-policy'),
    /frame-ancestors 'none'/,
  );
  assert.match(
    r.headers.get('content-security-policy'),
    /connect-src 'self' blob:/,
  );
  assert.equal(r.headers.get('cross-origin-opener-policy'), 'same-origin');
  for (const route of [
    '/missing.js',
    '/constructor',
    '/tiles/buildings/99/99999/99999.b3dm',
    '/tiles/imagery/19/1/1.jpeg',
    '/tiles/terrain/17/1/1.terrain?v=1.43646.0',
  ])
    assert.equal((await fetch(base + route)).status, 404, route);
});
test('only admitted official geometry is proxied, byte-for-byte with a real content hash, then cached', async (t) => {
  const receipt = JSON.parse(
    fs.readFileSync(path.join(app, 'pilot/buildings/SOURCE_RECEIPT.json')),
  );
  const tile = receipt.admitted_content_paths[0];
  let reads = 0;
  const body = Buffer.alloc(40);
  body.write('b3dm');
  body.writeUInt32LE(1, 4);
  body.writeUInt32LE(body.length, 8);
  const { base } = await fixture(t, async (url, options) => {
    reads++;
    assert.equal(
      url,
      'https://3d.geo.admin.ch/ch.swisstopo.swissbuildings3d.3d/v1/20260520/' +
        tile,
    );
    assert.equal(options.redirect, 'error');
    assert.equal(options.method, 'GET');
    return new Response(body);
  });
  for (let i = 0; i < 2; i++) {
    const r = await fetch(base + '/tiles/buildings/' + tile);
    assert.equal(r.status, 200);
    assert.equal(r.headers.get('x-worldseye-source-sha256'), sha(body));
    assert.deepEqual(Buffer.from(await r.arrayBuffer()), body);
  }
  assert.equal(reads, 1);
});
test('malformed or undersized B3DM fails closed', async (t) => {
  const receipt = JSON.parse(
    fs.readFileSync(path.join(app, 'pilot/buildings/SOURCE_RECEIPT.json')),
  );
  const { base } = await fixture(
    t,
    async () => new Response(Buffer.from('b3dm')),
  );
  assert.equal(
    (
      await fetch(
        base + '/tiles/buildings/' + receipt.admitted_content_paths[0],
      )
    ).status,
    502,
  );
});
test('terrain versions, extensions and image routes cannot select another provider or dataset', async (t) => {
  const calls = [];
  const { base } = await fixture(t, async (url) => {
    calls.push(url);
    return new Response(
      JSON.stringify({
        maxzoom: 18,
        tiles: ['{z}/{x}/{y}.terrain?v=1.43646.0'],
      }),
    );
  });
  assert.equal((await fetch(base + '/tiles/terrain/layer.json')).status, 200);
  assert.equal(
    calls[0],
    'https://3d.geo.admin.ch/ch.swisstopo.terrain.3d/v1/20250101/layer.json',
  );
  for (const q of [
    'v=other',
    'v=1.43646.0&url=https://evil.test',
    'v=1.43646.0&v=1.43646.0',
  ])
    assert.equal(
      (await fetch(base + '/tiles/terrain/0/0/0.terrain?' + q)).status,
      404,
    );
  assert.equal(calls.length, 1);
});
test('image dimensions reject decompression bombs before browser decode', () => {
  const png = Buffer.alloc(24);
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).copy(png);
  png.write('IHDR', 12);
  png.writeUInt32BE(400, 16);
  png.writeUInt32BE(300, 20);
  assert.equal(imageType(png), 'image/png');
  png.writeUInt32BE(8193, 16);
  assert.equal(imageType(png), null);
  png.writeUInt32BE(5000, 16);
  png.writeUInt32BE(5000, 20);
  assert.equal(imageType(png), null);
  assert.equal(imageType(Buffer.from([255, 216, 255])), null);
});
test('the gateway consumes the existing SPECTRA owner and emits its normalized projection only', async (t) => {
  const { base } = await fixture(t, async (url) => {
    assert.equal(url, 'http://127.0.0.1:5198/n4/api/asso/spectra/war-room');
    return new Response(JSON.stringify({ secret: 'MUST_NOT_ESCAPE' }), {
      headers: { 'Content-Type': 'application/json' },
    });
  });
  const r = await fetch(base + '/api/observations');
  const body = await r.text();
  assert.equal(r.status, 200);
  assert.doesNotMatch(body, /MUST_NOT_ESCAPE/);
  assert.equal(JSON.parse(body).read_only, true);
});
test('an oversized chunked response is cancelled and releases its upstream slot', async (t) => {
  let cancelled = false;
  const { base } = await fixture(
    t,
    async () =>
      new Response(
        new ReadableStream({
          start(c) {
            c.enqueue(new Uint8Array(1048577));
          },
          cancel() {
            cancelled = true;
          },
        }),
      ),
  );
  assert.equal((await fetch(base + '/api/observations')).status, 502);
  assert.equal(cancelled, true);
  const health = await (await fetch(base + '/api/health')).json();
  assert.equal(health.active, 0);
});
test('disconnect cancels in-flight reads and frees the bounded queue', async (t) => {
  let active = 0,
    peak = 0;
  const { base } = await fixture(t, async (_url, { signal }) => {
    active++;
    peak = Math.max(peak, active);
    return await new Promise((_resolve, reject) => {
      const stop = () => {
        active--;
        reject(Error('cancelled'));
      };
      if (signal.aborted) stop();
      else signal.addEventListener('abort', stop, { once: true });
    });
  });
  const controllers = Array.from({ length: 8 }, () => new AbortController());
  const pending = controllers.map((c) =>
    fetch(base + '/api/observations', { signal: c.signal }).catch(() => null),
  );
  await new Promise((resolve) => setTimeout(resolve, 100));
  assert.ok(peak <= 4 && peak > 0);
  assert.equal((await fetch(base + '/api/health')).status, 429);
  controllers.forEach((c) => c.abort());
  await Promise.all(pending);
  await new Promise((resolve) => setTimeout(resolve, 100));
  assert.equal(active, 0);
  const health = await (await fetch(base + '/api/health')).json();
  assert.equal(health.active, 0);
  assert.equal(health.queued, 0);
});
test('tampered static content and symlink escapes cannot be served', async (t) => {
  const { root, base } = await fixture(t);
  fs.writeFileSync(path.join(root, 'index.html'), '<script>changed</script>');
  assert.equal((await fetch(base + '/')).status, 503);
  fs.unlinkSync(path.join(root, 'index.html'));
  fs.symlinkSync(
    path.join(root, '../outside-fixture'),
    path.join(root, 'index.html'),
  );
  assert.equal((await fetch(base + '/')).status, 503);
});
