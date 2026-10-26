import { fileURLToPath, URL } from 'node:url';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vitest/config';

// BASE_PATH lets the same build run at a domain root or under a sub-path
// such as GitHub Pages (https://<user>.github.io/kibitz-chess/).
export default defineConfig({
  base: process.env.BASE_PATH ?? '/',
  plugins: [react(), tailwindcss()],
  build: {
    // The opening book (~700 kB of position data, ~100 kB gzipped) is its own lazily
    // loaded chunk; everything else stays well under Vite's default 500 kB warning.
    chunkSizeWarningLimit: 800,
  },
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.{ts,tsx}'],
    setupFiles: ['src/test/setup.ts'],
  },
});
