import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  // Relative asset paths, so the build works from a domain root or a subfolder (e.g. GitHub Pages).
  base: './',
  server: { port: 5178 },
});
