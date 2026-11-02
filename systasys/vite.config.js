import { fileURLToPath, URL } from 'node:url'
import { defineConfig } from 'vite'
const entryDir=fileURLToPath(new URL('./',import.meta.url))
export default defineConfig({
 root:entryDir,base:'/n4/worlds-eye-app/',publicDir:false,
 build:{target:'es2022',outDir:fileURLToPath(new URL('./dist',import.meta.url)),emptyOutDir:true,minify:'esbuild',sourcemap:false,
  rollupOptions:{output:{
   // Keep first-party UI text in the entry, separately from the generated
   // dependency build. Stable vendor caching and voice checks then examine
   // application phrases rather than minified Cesium variable names.
   manualChunks:id=>id.includes('/node_modules/')?'engine':undefined,
   chunkFileNames:'assets/build/[name]-[hash].js'
  }}
 }
})
