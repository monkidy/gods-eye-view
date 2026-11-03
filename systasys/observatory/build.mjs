import {
  cpSync,
  existsSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { spawnSync, execFileSync } from 'node:child_process';
import { build } from 'esbuild';
const app = fileURLToPath(new URL('./', import.meta.url)),
  root = resolve(app, '../..'),
  dist = resolve(app, 'dist');
const vite = resolve(root, 'node_modules/vite/bin/vite.js');
const r = spawnSync(
  process.execPath,
  [vite, 'build', '--config', 'systasys/observatory/vite.config.js'],
  { cwd: root, stdio: 'inherit' },
);
if (r.status !== 0) process.exit(r.status || 1);
await build({
  entryPoints: [resolve(app, 'gateway-entry.mjs')],
  outfile: resolve(app, 'release/gateway.cjs'),
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node20',
  minify: false,
  sourcemap: false,
});
for (const name of ['Workers', 'Assets', 'Widgets', 'ThirdParty'])
  cpSync(
    resolve(root, 'node_modules/cesium/Build/CesiumUnminified', name),
    resolve(dist, 'cesium', name),
    { recursive: true },
  );
cpSync(resolve(app, 'pilot'), resolve(dist, 'pilot'), { recursive: true });
for (const [source, target] of [
  ['LICENSE', 'LICENSE_WORLDSEYE.md'],
  ['node_modules/cesium/LICENSE.md', 'LICENSE_CESIUM.md'],
])
  cpSync(resolve(root, source), resolve(dist, target));
const entries = {};
let totalBytes = 0;
function walk(dir) {
  for (const name of readdirSync(dir).sort()) {
    const file = resolve(dir, name);
    if (statSync(file).isDirectory()) walk(file);
    else {
      const data = readFileSync(file);
      const key = relative(dist, file).split('\\').join('/');
      entries[key] = {
        size: data.length,
        sha256: createHash('sha256').update(data).digest('hex'),
      };
      totalBytes += data.length;
    }
  }
}
walk(dist);
const source = execFileSync('git', ['rev-parse', 'HEAD'], {
  cwd: root,
  encoding: 'utf8',
}).trim();
const dirty =
  execFileSync('git', ['status', '--porcelain', '--untracked-files=normal'], {
    cwd: root,
    encoding: 'utf8',
  }).trim().length > 0;
writeFileSync(
  resolve(dist, 'MANIFEST.json'),
  JSON.stringify(
    {
      schema: 'SYSTASYS_WORLDS_EYE_OBSERVATORY_BUNDLE_V2',
      source_sha: source,
      working_tree_dirty: dirty,
      build_scope: dirty
        ? 'LOCAL_PROTOTYPE_NOT_RELEASEABLE'
        : 'COMMITTED_SOURCE',
      totalBytes,
      entries,
    },
    null,
    2,
  ) + '\n',
);
console.log(
  JSON.stringify({
    schema: 'WORLDSEYE_V2_BUILD',
    files: Object.keys(entries).length,
    totalBytes,
    source_sha: source,
  }),
);
cpSync(dist, resolve(app, 'release/dist'), { recursive: true });
