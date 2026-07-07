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
    proxy: {
      // 프런트는 상대경로 /api 로 호출(.env.local VITE_API_BASE_URL="") → Vite가 백엔드로 프록시.
      // 다른 PC도 192.9.100.57:5173 한 곳만 보므로 동일 출처(CORS/쿠키 이슈 없음). 백엔드는 localhost 유지.
      '/api': {
        target: 'http://localhost:8000',
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
