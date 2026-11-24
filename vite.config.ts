import { defineConfig } from 'vite';

// Two pages: the 3D game at the root and the pixel edition at /pixel/.
export default defineConfig({
  base: '/coolmath-turn-ball/',
  build: {
    outDir: 'dist',
    assetsInlineLimit: 0,
    chunkSizeWarningLimit: 900,
    rollupOptions: { input: { main: 'index.html', pixel: 'pixel/index.html' } },
  },
});
