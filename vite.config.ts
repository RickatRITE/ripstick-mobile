import { defineConfig } from 'vite';
import path from 'path';

export default defineConfig({
  root: '.',
  base: '/ripstick-mobile/',
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    rollupOptions: {
      // Ensure ../shared/ imports resolve packages from this project's node_modules
      makeAbsoluteExternalsRelative: false,
    },
  },
  resolve: {
    alias: {
      // When Vite encounters bare imports from ../shared/, resolve them here
      '@tiptap': path.resolve(__dirname, 'node_modules/@tiptap'),
      'tiptap-markdown': path.resolve(__dirname, 'node_modules/tiptap-markdown'),
      'ulid': path.resolve(__dirname, 'node_modules/ulid'),
    },
  },
  server: {
    fs: { allow: ['..'] },
  },
});
