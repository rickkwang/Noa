import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import {defineConfig} from 'vite';

export default defineConfig(() => {
  const isDesktopBuild = process.env.BUILD_TARGET === 'desktop';
  const chunkRules: Array<{ name: string; includes: string[] }> = [
    { name: 'vendor-react', includes: ['/node_modules/react/', '/node_modules/react-dom/'] },
    { name: 'vendor-codemirror', includes: ['/node_modules/@codemirror/'] },
    { name: 'markdown-core', includes: ['/node_modules/react-markdown/'] },
    {
      name: 'markdown-plugins',
      includes: [
        '/node_modules/remark-gfm/',
        '/node_modules/remark-math/',
        '/node_modules/rehype-highlight/',
        '/node_modules/rehype-katex/',
        '/node_modules/rehype-raw/',
      ],
    },
    {
      name: 'markdown-render',
      includes: ['/node_modules/highlight.js/', '/node_modules/katex/'],
    },
    { name: 'vendor-graph', includes: ['/node_modules/react-force-graph-2d/', '/node_modules/d3-force/'] },
    { name: 'vendor-misc', includes: ['/node_modules/fuse.js/', '/node_modules/localforage/', '/node_modules/dompurify/', '/node_modules/jszip/'] },
  ];

  const manualChunks = (id: string): string | undefined => {
    if (!id.includes('/node_modules/')) return undefined;
    for (const rule of chunkRules) {
      if (rule.includes.some((needle) => id.includes(needle))) {
        return rule.name;
      }
    }
    return undefined;
  };

  return {
    define: {
      'import.meta.env.PACKAGE_VERSION': JSON.stringify(process.env.npm_package_version ?? 'dev'),
    },
    base: isDesktopBuild ? './' : '/',
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
          manualChunks,
        },
      },
    },
  };
});
