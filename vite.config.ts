import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import {defineConfig} from 'vite';

export default defineConfig(() => {
  return {
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    server: {
      hmr: true,
    },
    build: {
      rollupOptions: {
        output: {
          manualChunks: {
            'vendor-react': ['react', 'react-dom'],
            'vendor-markdown': ['react-markdown', 'remark-gfm', 'remark-math', 'rehype-highlight', 'rehype-katex', 'rehype-raw'],
            'vendor-graph': ['react-force-graph-2d', 'd3-force'],
            'vendor-misc': ['fuse.js', 'localforage', 'dompurify', 'jszip'],
          },
        },
      },
    },
  };
});
