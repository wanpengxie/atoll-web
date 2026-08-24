import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const serverURL = process.env.ATOLL_SERVER_URL || 'http://localhost:8832';

export default defineConfig({
  plugins: [react()],
  test: {
    exclude: ['tests/browser/**', '**/node_modules/**', '**/dist/**'],
    setupFiles: ['tests/setup.js'],
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    sourcemap: true,
  },
  server: {
    port: 5173,
    allowedHosts: ['tardis', 'tardis.tail6bc2a1.ts.net'],
    proxy: {
      '/api': { target: serverURL, changeOrigin: true },
      // 保留浏览器原始 Host，使 Atoll 的同源 WebSocket 校验看到的
      // Origin 与 Host 一致；HTTP 代理仍可对 OBS/identity 改写 Host。
      '/ws': { target: serverURL, ws: true, changeOrigin: false },
      // 终端是第二条 WS（见 .dalek/pm/terminal-line-design.md §4.5）。
      // 与 /ws 同样保留浏览器原始 Host：门做同源校验时看到的 Origin 必须与
      // Host 一致，否则升级会被拒。
      '/pty': { target: serverURL, ws: true, changeOrigin: false },
      '/obs': { target: serverURL, changeOrigin: true },
      '/mock': { target: serverURL, changeOrigin: true },
      '/files': { target: serverURL, changeOrigin: true },
    },
  },
});
