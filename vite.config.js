import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import fs from 'node:fs';
import path from 'node:path';

/**
 * Serve a pre-compressed .gz alongside any file under /data when the browser
 * accepts gzip. The per-gene count files are a few hundred megabytes of JSON
 * and compress by roughly an order of magnitude, so this is the difference
 * between tens of seconds and a few on first opening a gene. Compression is
 * done once, offline, rather than per request.
 */
function precompressedData() {
  const handler = (root) => (req, res, next) => {
    const url = (req.url || '').split('?')[0];
    if (!url.startsWith('/data/')) return next();
    if (!url.endsWith('.json') && !url.endsWith('.bin')) return next();
    if (!/\bgzip\b/.test(req.headers['accept-encoding'] || '')) return next();

    const gz = path.join(root, decodeURIComponent(url) + '.gz');
    let st;
    try { st = fs.statSync(gz); } catch { return next(); }

    res.setHeader('Content-Encoding', 'gzip');
    res.setHeader('Content-Type', url.endsWith('.bin') ? 'application/octet-stream' : 'application/json');
    res.setHeader('Content-Length', st.size);
    res.setHeader('Cache-Control', 'public, max-age=3600');
    fs.createReadStream(gz).pipe(res);
  };
  return {
    name: 'serve-precompressed-data',
    configureServer(server) {
      server.middlewares.use(handler(path.resolve('public')));
    },
    configurePreviewServer(server) {
      server.middlewares.use(handler(path.resolve('dist')));
    },
  };
}

export default defineConfig({
  plugins: [react(), precompressedData()],
  base: './',
  server: {
    host: true,
    port: 8080,
    strictPort: false,
    open: false,
    allowedHosts: ['hapbrowser.jbnu.ac.kr'],
    proxy: {
      '/api': {
        target: 'http://localhost:8081',
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: 'dist',
    assetsInlineLimit: 0,
  },
});
