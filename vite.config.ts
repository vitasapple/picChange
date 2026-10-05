import { defineConfig } from "vite";

// Tauri 项目专用 Vite 配置
export default defineConfig({
  clearScreen: false,
  server: {
    port: 5173,
    strictPort: true,
    watch: {
      // 避免监听 src-tauri 下的 Rust 源码引发热重载风暴
      ignored: ["**/src-tauri/**"],
    },
  },
  build: {
    target: "es2021",
    outDir: "dist",
    emptyOutDir: true,
  },
});