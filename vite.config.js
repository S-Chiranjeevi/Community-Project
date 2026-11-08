import { defineConfig } from 'vite';
export default defineConfig({
  publicDir: false,
  build: { outDir: 'public', emptyOutDir: true },
  server: {
    proxy: { '/api': 'http://localhost:3000' }
  }
});
