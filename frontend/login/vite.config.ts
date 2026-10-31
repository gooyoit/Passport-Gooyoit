import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [
    react(),
    {
      // Vite injects dev styles as inline <style>; the strict CSP meta blocks that.
      name: "loosen-csp-in-dev",
      apply: "serve",
      transformIndexHtml(html) {
        return html.replace(
          /<meta http-equiv="Content-Security-Policy".*?>\s*/,
          "",
        );
      },
    },
  ],
  server: {
    port: 5173,
    proxy: {
      "/api": {
        target: "http://127.0.0.1:8080",
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api/, ""),
      },
    },
  },
});
