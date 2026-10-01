import { defineConfig } from "vite";

export default defineConfig({
  clearScreen: false,
  server: { port: 1420, strictPort: true },
  build: { target: ["es2021", "chrome105", "safari15"], outDir: "dist", emptyOutDir: true },
});
