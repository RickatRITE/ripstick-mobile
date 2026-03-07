import { defineConfig } from 'vite';

export default defineConfig({
  root: '.',
  base: '/ripstick-mobile/',
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
  server: {
    fs: { allow: ['..'] },
  },
});
