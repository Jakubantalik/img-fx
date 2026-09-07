import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'path';

export default defineConfig({
  plugins: [react()],
  root: resolve(__dirname, 'demo'),
  publicDir: resolve(__dirname, 'demo/public'),
  resolve: {
    alias: {
      'img-fx': resolve(__dirname, 'src/index.ts')
    }
  },
  build: {
    outDir: resolve(__dirname, 'dist-demo'),
    emptyOutDir: true,
    rollupOptions: {
      // Multi-page build. The root is the "moved to libraries.dev" page; the
      // playground that used to be the root now lives under /demo/, and the
      // click-to-generate showcase keeps its own entry.
      input: {
        index: resolve(__dirname, 'demo/index.html'),
        demo: resolve(__dirname, 'demo/demo/index.html'),
        showcase: resolve(__dirname, 'demo/showcase.html')
      }
    }
  }
});
