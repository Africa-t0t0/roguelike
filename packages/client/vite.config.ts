import { defineConfig } from "vite";

export default defineConfig({
  server: { port: 5173 },
  // Babylon (motor + shaders) pesa ~1,2 MB minificado; no es crítico en este prototipo.
  build: { chunkSizeWarningLimit: 1500 },
});
