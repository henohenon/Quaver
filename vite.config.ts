import { defineConfig } from 'vite';

// dev時は base '/' で localhost ルートから配信。
// build時のみ GitHub Pages 用の '/Quaver/' を base にする。
export default defineConfig(({ command }) => ({
  base: command === 'build' ? '/Quaver/' : '/',
  build: {
    outDir: 'dist',
    sourcemap: true,
  },
  server: {
    host: true,
  },
}));
