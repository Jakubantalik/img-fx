import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'path';

export default defineConfig({
  plugins: [react()],
  root: resolve(__dirname, 'demo'),
  publicDir: resolve(__dirname, 'demo/public'),
  resolve: {
    alias: {
      'image-fx': resolve(__dirname, 'src/index.ts')
    }
  },
  build: {
    outDir: resolve(__dirname, 'dist-demo'),
    emptyOutDir: true
  }
});
