import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const serverURL = process.env.ATOLL_SERVER_URL || 'http://localhost:8832';

export default defineConfig({
  plugins: [react()],
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    sourcemap: true,
  },
  server: {
    port: 5173,
    proxy: {
      '/api': { target: serverURL, changeOrigin: true },
      '/ws': { target: serverURL, ws: true, changeOrigin: true },
      '/obs': { target: serverURL, changeOrigin: true },
      '/mock': { target: serverURL, changeOrigin: true },
    },
  },
});
