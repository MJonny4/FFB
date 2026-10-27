import react, { reactCompilerPreset } from "@vitejs/plugin-react";
import babel from "@rolldown/plugin-babel";
import { defineConfig } from "vite";

// https://vite.dev/config/
export default defineConfig({
  server: {
    proxy: {
      "/api": { target: "http://localhost:3000", ws: true },
      "/health": "http://localhost:3000",
    },
  },
  plugins: [react(), babel({ presets: [reactCompilerPreset()] })],
});
