/// <reference types="vite/client" />

/** 前端调用 Rust 后端的转换任务结构 */
export interface ConvertRequest {
  /** 输入文件路径 */
  srcPath: string;
  /** 输出目录 */
  outDir: string;
  /** 目标格式（PNG/JPEG/BMP/TIFF/WEBP） */
  targetFormat: string;
  /** JPEG/WEBP 质量 1-100 */
  quality: number;
}

export interface ConvertResult {
  success: boolean;
  outputPath: string | null;
  error: string | null;
}

/** Tauri 前端 API 封装 */
declare global {
  interface Window {
    __TAURI__?: {
      invoke: <T>(cmd: string, args?: Record<string, unknown>) => Promise<T>;
    };
  }
}

export async function invoke<T>(
  cmd: string,
  args?: Record<string, unknown>
): Promise<T> {
  const api = window.__TAURI__;
  if (!api) {
    throw new Error("未检测到 Tauri 运行时，请通过 `npm run tauri dev` 启动应用。");
  }
  return api.invoke<T>(cmd, args);
}