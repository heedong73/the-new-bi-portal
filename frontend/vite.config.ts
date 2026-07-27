/// <reference types="vitest/config" />
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import path from 'path'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    host: true, // 0.0.0.0 바인딩 → 같은 사내망의 다른 PC에서 http://<내IP>:5173 로 접속 가능
    port: 5173,
    // Docker 개발 컨테이너에서 bind mount 변경 감지가 안 되는 경우 폴링 사용(VITE_USE_POLLING=true).
    watch: process.env.VITE_USE_POLLING ? { usePolling: true, interval: 300 } : undefined,
    proxy: {
      // 프런트는 상대경로 /api 로 호출(.env.local VITE_API_BASE_URL="") → Vite가 백엔드로 프록시.
      // 로컬 실행은 localhost:8000, Docker compose 실행은 VITE_PROXY_TARGET=http://backend:8000.
      '/api': {
        target: process.env.VITE_PROXY_TARGET || 'http://localhost:8000',
        changeOrigin: true,
      },
    },
  },
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: './src/test/setup.ts',
  },
})
