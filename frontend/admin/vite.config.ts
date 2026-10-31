import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
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
    host: "127.0.0.1",
    port: 5174,
    proxy: {
      "/api": {
        target: "http://127.0.0.1:8081",
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api/, ""),
      },
    },
  },
});
