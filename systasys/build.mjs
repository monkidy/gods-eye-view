import { cpSync, existsSync, mkdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
const root = fileURLToPath(new URL('../', import.meta.url))
const base = resolve(root, 'node_modules', 'cesium', 'Build', 'CesiumUnminified')
const dest = resolve(root, 'systasys', 'dist', 'cesium')
if (!existsSync(resolve(base, 'Workers'))) throw Error('CESIUM_WORKERS_NOT_FOUND')
const vite = resolve(root, 'node_modules', 'vite', 'bin', 'vite.js')
const result = spawnSync(process.execPath, [vite, 'build', '--config', 'systasys/vite.config.js'], {cwd:root,stdio:'inherit'})
if (result.status !== 0) process.exit(result.status || 1)
mkdirSync(dest, {recursive:true})
for(const dir of ['Workers','Assets','Widgets','ThirdParty']) {
 const src=resolve(base,dir)
 if (!existsSync(src)) throw Error('CESIUM_REQUIRED_ASSET_MISSING:'+dir)
 cpSync(src,resolve(dest,dir),{recursive:true})
}
// Vite empties dist on every build. Copy the applicable license texts only
// after that step so a clean build retains both source and Cesium attribution.
for (const [source, name] of [
  [resolve(root, 'node_modules', 'cesium', 'LICENSE.md'), 'LICENSE_CESIUM.md'],
  [resolve(root, 'LICENSE'), 'LICENSE_WORLDSEYE.md'],
]) {
  if (!existsSync(source)) throw Error('DIST_LICENSE_MISSING:' + name)
  cpSync(source, resolve(root, 'systasys', 'dist', name))
}
for(const file of ['index.html','assets']) if(!existsSync(resolve(root,'systasys','dist',file)))throw Error('DIST_MISSING:'+file)
console.log('SYSTASYS_CESIUM_ASSET_PACK=PASS')
