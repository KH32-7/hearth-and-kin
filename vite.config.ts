import { defineConfig } from 'vite';
import { vendorAssets } from './tools/vite-assets';

export default defineConfig({
  // 이미지 경로는 레포 루트 기준 (artifacts/contracts.md). 개발 서버는 루트를 그대로 제공
  plugins: [vendorAssets()],
  server: {
    host: '127.0.0.1',
    port: 5188,
    strictPort: true,
    // 에셋 원본(수만 개 파일)과 산출물 폴더는 감시하지 않음 → 시작/새로고침 지연 방지
    watch: { ignored: ['**/assets/vendor/**', '**/artifacts/**', '**/node_modules/**', '**/.git/**'] },
    fs: { strict: true, allow: ['.'] },
  },
  optimizeDeps: {
    entries: ['index.html'],
    include: ['three', 'zod'],
  },
  preview: {
    host: '127.0.0.1',
    port: 4188,
    strictPort: true,
  },
  worker: { format: 'es' },
  build: {
    sourcemap: true,
    chunkSizeWarningLimit: 900,
  },
});
