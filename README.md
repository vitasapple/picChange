# 图片格式转换器 (Tauri v2)

基于 **Tauri v2 + Rust + Vite/TypeScript** 的跨平台桌面图片格式批量转换工具。

**支持平台**：macOS（Intel + Apple Silicon）、Windows

## ✨ 功能

- **HEIC / HEIF → PNG / JPG / BMP / TIFF / WEBP**（苹果照片核心需求）
- **PNG / JPG / BMP / TIFF / WEBP** 互转
- 批量添加、拖拽导入、输出格式/质量选择
- 深色主题 UI，转换不卡界面

## 🏗 技术架构

```
┌─────────────────────────┐        ┌──────────────────────────┐
│   前端 (Vite + TS)       │  invoke │   Rust 后端 (Tauri)      │
│  - 文件列表 / 拖拽       │ ──────► │  convert_image 命令       │
│  - 格式/质量/目录选择    │         │   ├─ HEIC 解码            │
│  - 调用后端转换          │ ◄────── │   │   ├─ macOS: sips      │
│                         │         │   │   └─ Win/Linux: libheif│
└─────────────────────────┘         │   └─ image crate 编码     │
                                    └──────────────────────────┘
```

**HEIC 解码策略（跨平台）**：
- **macOS**：调用系统自带 `sips`（已验证 3840×2160 无损解码），零额外依赖
- **Windows/Linux**：使用 `libheif-rs`（通过 vcpkg 安装 libheif）

## 🚀 本地开发

```bash
# 1. 安装前端依赖（若 NODE_ENV=production 需加 --include=dev）
npm install --include=dev

# 2. 启动开发环境（需要本地 Rust 工具链）
npm run tauri dev
```

## 📦 用 GitHub Actions 打包（无需本地 Rust）

推送 tag 即可自动触发跨平台构建：

```bash
git tag v0.1.1 && git push origin v0.1.1
```

工作流 `.github/workflows/build-release.yml` 会：
- macOS runner 构建**通用版** `.dmg`（Intel + Apple Silicon）
- Windows runner 构建 `.exe`（NSIS）+ `.msi`
- 汇总后自动创建 **Draft Release**，你到 Releases 页发布即可

## 📁 项目结构

```
tauri-pic-converter/
├── .github/workflows/build-release.yml  # 跨平台 CI 打包
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
    ├── vcpkg.json   # Windows 依赖 libheif
    ├── icons/       # 已生成的 .icns/.ico/.png
    └── src/
        ├── main.rs
        ├── lib.rs
        └── converter.rs   # 核心转换逻辑（含跨平台 HEIC 支持）
```

## 🛠 支持格式

| 输入 | 输出 |
|------|------|
| HEIC, HEIF | PNG, JPEG, BMP, TIFF, WEBP |
| PNG, JPG, BMP, TIFF, WEBP | 以上互转 |

## ⚠️ 注意事项

- macOS 上 HEIC 走系统 `sips`；Windows 依赖 vcpkg 的 libheif（CI 已自动安装）
- 转换结果保存为**同名不同扩展名**，与原文件同目录（或指定输出目录）