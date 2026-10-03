import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { cloudflare } from '@cloudflare/vite-plugin';

// React SPA + Cloudflare Worker (same origin) wired by the Cloudflare Vite plugin.
// Tailwind v4 plugin is required for Kumo's class discovery (@source in styles.css).
export default defineConfig({
  plugins: [react(), tailwindcss(), cloudflare()],
  build: {
    rollupOptions: {
      output: {
        // Split heavy vendor libs into separately-cacheable chunks: smaller initial
        // parse + long-term caching (a Kumo/React bump doesn't re-download app code).
        manualChunks: {
          'vendor-react': ['react', 'react-dom'],
          'vendor-kumo': ['@cloudflare/kumo'],
          'vendor-icons': ['@phosphor-icons/react'],
        },
      },
    },
  },
});
