import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { cloudflare } from '@cloudflare/vite-plugin';

// React SPA + Cloudflare Worker (same origin) wired by the Cloudflare Vite plugin.
// Tailwind v4 plugin is required for Kumo's class discovery (@source in styles.css).
export default defineConfig({
  plugins: [react(), tailwindcss(), cloudflare()],
});
