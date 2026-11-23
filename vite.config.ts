import { defineConfig } from 'vite';

export default defineConfig({
  base: '/coolmath-turn-ball/',
  build: { outDir: 'dist', assetsInlineLimit: 0, chunkSizeWarningLimit: 900 },
});
