import { fileURLToPath, URL } from 'node:url'
import { defineConfig } from 'vite'
const entryDir=fileURLToPath(new URL('./',import.meta.url))
export default defineConfig({
 root:entryDir,base:'/n4/worlds-eye-app/',publicDir:false,
 build:{target:'es2022',outDir:fileURLToPath(new URL('./dist',import.meta.url)),emptyOutDir:true,minify:'esbuild',sourcemap:false}
})
