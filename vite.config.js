import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const serverURL = process.env.ATOLL_SERVER_URL || 'http://localhost:8832';

export default defineConfig({
  plugins: [react()],
  test: {
    // .claude/** 是子 agent 的隔离 worktree 落点：它带完整 tests/ 与 node_modules，不排除
    // 就会被当成本仓库的测试收集（2026-09-18 一次收进 240 个文件，全量凭空多出 60 个"失败文件"）。
    exclude: [
      'tests/browser/**',
      'docs/evidence/**',
      'audit-output/**',
      '**/node_modules/**',
      '**/dist/**',
      '.claude/**',
      '**/.claude/**',
      '.tmp-*/**',
      '**/.tmp-*/**',
      'test-results*/**',
      '**/test-results*/**',
      '**/.worktrees/**',
      '**/.review-*/**',
      '**/atoll-web-*/**',
    ],
    setupFiles: ['tests/setup.js'],
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    sourcemap: true,
  },
  server: {
    port: 5173,
    watch: {
      // Browser evidence is not application source. Watching traces and
      // screenshots can exhaust inotify and take down the development entry.
      ignored: [
        '**/.worktrees/**',
        '**/.review-*/**',
        '**/.tmp-*/**',
        '**/test-results*/**',
        '**/playwright-report*/**',
        '**/docs/evidence/**',
        '**/audit-output/**',
      ],
    },
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
      // 开发入口放到 Tailscale Serve 的根路径时，daemon 的 carrier 也会先
      // 到 Vite。它不是浏览器连接，但必须原样穿到节点，不能落入 SPA fallback。
      '/compute': { target: serverURL, ws: true, changeOrigin: false },
      '/healthz': { target: serverURL, changeOrigin: true },
      '/obs': { target: serverURL, changeOrigin: true },
      '/mock': { target: serverURL, changeOrigin: true },
      '/files': { target: serverURL, changeOrigin: true },
    },
  },
});
