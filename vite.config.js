import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// --mode static: versión de demostración sin servidor (GitHub Pages), con rutas relativas.
export default defineConfig(({ mode }) => ({
  base: mode === "static" ? "./" : "/",
  plugins: [react()],
  server: { proxy: { "/api": "http://localhost:3000" } },
}));
