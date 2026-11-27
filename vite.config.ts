import { defineConfig } from "vite";

export default defineConfig(({ isSsrBuild }) => ({
  base: "./",
  build: {
    target: "es2022",
    rollupOptions: isSsrBuild
      ? {}
      : { input: ["index.html", "demo.html", "schedule-demo.html"] },
  },
}));
