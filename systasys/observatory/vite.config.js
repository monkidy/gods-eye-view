import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';
export default defineConfig({
  root: fileURLToPath(new URL('./', import.meta.url)),
  base: '/',
  publicDir: false,
  define: { CESIUM_BASE_URL: JSON.stringify('/cesium/') },
  build: {
    target: 'es2022',
    outDir: 'dist',
    emptyOutDir: true,
    minify: 'esbuild',
    sourcemap: false,
    rollupOptions: {
      output: {
        manualChunks: (id) =>
          id.includes('/node_modules/') ? 'engine' : undefined,
        chunkFileNames: 'assets/build/[name]-[hash].js',
      },
    },
  },
});
