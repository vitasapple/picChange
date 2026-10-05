# 图片格式转换器 (Tauri v2)

基于 **Tauri v2 + Rust + Vite/TypeScript** 的 macOS 桌面图片格式批量转换工具。

## ✨ 功能

- **HEIC / HEIF → PNG / JPG / BMP / TIFF / WEBP**（苹果照片核心需求）
- **PNG / JPG / BMP / TIFF / WEBP** 互转
- 批量添加、拖拽导入、输出格式/质量选择
- 深色主题 UI，多线程转换不卡界面

## 🏗 技术架构

```
┌─────────────────────────┐        ┌──────────────────────────┐
│   前端 (Vite + TS)       │  invoke │   Rust 后端 (Tauri)      │
│  - 文件列表 / 拖拽       │ ──────► │  convert_image 命令       │
│  - 格式/质量/目录选择    │         │   ├─ HEIC → sips 解码     │
│  - 调用后端转换          │ ◄────── │   └─ image crate 编码     │
└─────────────────────────┘        └──────────────────────────┘
```

**HEIC 解码策略**：macOS 上调用系统自带的 `sips`（已验证 3840×2160 无损解码），避免引入 libheif 系统依赖，**GitHub Actions 的 macos runner 无需额外安装任何库**。

## 🚀 本地开发

```bash
# 1. 安装前端依赖（注意：若 NODE_ENV=production 需加 --include=dev）
npm install --include=dev

# 2. 启动开发环境（需要本地 Rust 工具链）
npm run tauri dev
```

> 本地未安装 Rust 时，可以直接跳过步骤 2，用 `npx vite` 单独预览前端界面：
> ```bash
> npx vite
> # 浏览器打开 http://localhost:5173
> ```
> （此时没有 Rust 后端，界面可见但点击转换会提示未检测到 Tauri 运行时）

## 📦 用 GitHub Actions 打包（无需本地 Rust）

项目已配置 `.github/workflows/build-macos.yml`：

1. 把项目推到 GitHub 仓库
2. 打 tag：`git tag v0.1.0 && git push origin v0.1.0`
3. GitHub Actions 自动在 macos runner 上：
   - 安装 Node + Rust
   - `npm ci` 安装前端依赖
   - `tauri-apps/tauri-action` 构建并生成 `.dmg` / `.app`
   - 生成 Draft Release，到 Releases 页手动发布即可

> **为什么体积小**：Tauri 用 WebView 渲染，不打包浏览器内核，`.app` 通常只有 **10~20 MB**，远小于 Electron（100MB+）或 Python+PyQt（60~150MB）。

## 📁 项目结构

```
tauri-pic-converter/
├── .github/workflows/build-macos.yml  # CI 打包
├── index.html
├── package.json
├── vite.config.ts
├── tsconfig.json
├── src/
│   ├── main.ts      # 前端 UI 与交互逻辑
│   ├── style.css    # 深色主题样式
│   └── tauri.ts     # Tauri API 调用封装
└── src-tauri/
    ├── Cargo.toml
    ├── build.rs
    ├── tauri.conf.json
    ├── capabilities/main.json
    ├── icons/       # 已生成的 .icns/.ico/.png
    └── src/
        ├── main.rs
        ├── lib.rs
        └── converter.rs   # 核心转换逻辑（含 HEIC 支持）
```

## 🛠 支持格式

| 输入 | 输出 |
|------|------|
| HEIC, HEIF | PNG, JPEG, BMP, TIFF, WEBP |
| PNG, JPG, BMP, TIFF, WEBP | 以上互转 |

## ⚠️ 注意事项

- HEIC 解码依赖 macOS `sips`，Windows/Linux 版本需要改用 libheif 或纯 Rust 解码器（当前未支持跨平台 HEIC）
- 转换结果保存为**同名不同扩展名**，与原文件同目录（或指定输出目录）