import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import electron from 'vite-plugin-electron/simple';
import path from 'path';

export default defineConfig({
  cacheDir: path.resolve(__dirname, '../../.cache/vite/desktop'),
  plugins: [
    react(),
    tailwindcss(),
    electron({
      main: {
        entry: 'src/main/index.ts',
        vite: {
          build: {
            outDir: 'dist-electron',
            rollupOptions: {
              external: ['electron', 'electron-updater']
            }
          }
        }
      },
      preload: {
        input: 'src/preload/index.ts',
        vite: {
          build: {
            outDir: 'dist-electron/preload'
          }
        }
      }
    })
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
      '@': path.resolve(__dirname, './src')
    }
  }
});
