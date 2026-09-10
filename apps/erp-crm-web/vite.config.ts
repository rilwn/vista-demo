import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api': process.env['VISTA_API_PROXY_URL'] ?? 'http://localhost:3000',
    },
  },
  test: {
    environment: 'jsdom',
  },
});
