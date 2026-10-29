import { defineConfig } from 'vite';

// 用相对 base，这样不管部署到 username.github.io/godbox/ 还是自定义域名都能跑
export default defineConfig({
  base: './',
  build: {
    target: 'es2022',
    outDir: 'dist',
    assetsInlineLimit: 0,
  },
  server: {
    host: true,
    port: 5173,
  },
});
