import { defineConfig } from 'vite';

// Pages: the 3D game at the root, the pixel edition at /pixel/, the 1v1 duel at /1v1/ (?mode=timing|dice),
// the 1v1 card duel at /cards/, the 5v5 playbook at /5v5/, the animation viewer at /anims/ and the mode menu at /menu/.
export default defineConfig({
  base: '/coolmath-turn-ball/',
  build: {
    outDir: 'dist',
    assetsInlineLimit: 0,
    chunkSizeWarningLimit: 900,
    rollupOptions: { input: { main: 'index.html', pixel: 'pixel/index.html', duel: '1v1/index.html', cards: 'cards/index.html', team: '5v5/index.html', anims: 'anims/index.html', menu: 'menu/index.html' } },
  },
});
