import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { VitePWA } from "vite-plugin-pwa";
import path from "path";

export default defineConfig({
  cacheDir: path.resolve(__dirname, "../../.cache/vite/web"),
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: "autoUpdate",
      includeAssets: ["flux.svg"],
      workbox: { maximumFileSizeToCacheInBytes: 5 * 1024 * 1024 },
      manifest: {
        name: "FLUX",
        short_name: "FLUX",
        description: "Personal Knowledge Management",
        theme_color: "#1a1a1a",
        background_color: "#1a1a1a",
        display: "standalone",
        icons: [
          {
            src: "/flux.svg",
            sizes: "any",
            type: "image/svg+xml",
            purpose: "any maskable",
          },
        ],
      },
    }),
  ],
  build: {
    chunkSizeWarningLimit: 1000,
    rollupOptions: {
      output: {
        manualChunks: (id) => {
          if (id.includes('mermaid')) return 'mermaid';
          if (id.includes('katex')) return 'katex';
          if (id.includes('pdfjs-dist')) return 'pdfjs';
          if (id.includes('@codemirror')) return 'codemirror';
          if (id.includes('markdown-it')) return 'markdown';
          if (id.includes('d3')) return 'd3';
          if (id.includes('pixi.js')) return 'pixi';
          if (id.includes('prismjs')) return 'prism';
          if (id.includes('dompurify')) return 'dompurify';
        }
      }
    }
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  server: {
    port: 3000,
    proxy: {
      "/api": {
        target: process.env.FLUX_API_ORIGIN ?? "http://localhost:8080",
        changeOrigin: true,
      },
    },
  },
});
