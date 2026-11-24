import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// The admin panel is served by the same Node process under /admin.
export default defineConfig({
  base: '/admin/',
  plugins: [react()],
  // Styles are written out for phones a few years old too. Without this the build shortens
  // `(max-width: 860px)` to `(width<=860px)`, which iOS before 16.4 does not read at all.
  build: { cssTarget: ['chrome90', 'safari14', 'firefox90'] },
  server: {
    port: 5174,
    // In development the API runs separately: npm run dev --workspace server
    proxy: { '/api': 'http://localhost:3000', '/media': 'http://localhost:3000' },
  },
});
