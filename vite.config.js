import { defineConfig } from 'vite';

export default defineConfig({
  root: '.',
  plugins: [
    {
      name: 'disable-tif-cache',
      configureServer(server) {
        server.middlewares.use((req, res, next) => {
          if (req.url && req.url.endsWith('.tif')) {
            res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
            res.setHeader('Pragma', 'no-cache');
            res.setHeader('Expires', '0');
          }
          next();
        });
      }
    }
  ],
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  }
});
