import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';

export default defineConfig({
  plugins: [react()],
  resolve: { alias: { '@easy-kanban/shared': path.resolve(__dirname, '../../packages/shared/src/index.ts') } },
  server: {
    host: true,
    port: 5173,
    proxy: { '/api': { target: process.env.API_URL ?? 'http://localhost:8080', changeOrigin: true } },
  },
  build: { outDir: 'dist', sourcemap: false, chunkSizeWarningLimit: 900 },
});
