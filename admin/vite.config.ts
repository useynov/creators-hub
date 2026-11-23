import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// The admin panel is served by the same Node process under /admin.
export default defineConfig({
  base: '/admin/',
  plugins: [react()],
  server: {
    port: 5174,
    // In development the API runs separately: npm run dev --workspace server
    proxy: { '/api': 'http://localhost:3000', '/media': 'http://localhost:3000' },
  },
});
