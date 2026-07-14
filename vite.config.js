import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// api/ 配下のサーバーレス関数とは `vercel dev` が同一オリジンで束ねてくれるため、
// 開発用プロキシ設定は不要（本番のVercel上でも同一オリジン）。
export default defineConfig({
  plugins: [react()],
})
