import "./style.css";
import { invoke } from "./tauri";

/* ---------- 状态 ---------- */
interface RowItem {
  id: number;
  path: string;
  name: string;
  status: "待转换" | "转换中" | "成功" | "失败";
  outputPath: string | null;
  error: string | null;
}

const SUPPORTED_EXTS = [
  "heic", "heif", "png", "jpg", "jpeg",
  "bmp", "tif", "tiff", "webp",
];
const OUTPUT_FORMATS = ["PNG", "JPEG", "BMP", "TIFF", "WEBP"];

let items: RowItem[] = [];
let nextId = 1;
let isConverting = false;

/* ---------- DOM 引用 ---------- */
const app = document.getElementById("app")!;
app.innerHTML = `
  <div class="shell">
    <header class="topbar">
      <div class="brand">
        <span class="logo">↕</span>
        <h1>图片格式转换器</h1>
      </div>
      <div class="topbar-actions">
        <button id="btn-open" class="btn ghost">＋ 添加文件</button>
        <button id="btn-clear" class="btn ghost">清空列表</button>
      </div>
    </header>

    <section class="dropzone" id="dropzone">
      <div class="dz-inner">
        <p class="dz-icon">⬇</p>
        <p class="dz-text">把图片拖到这里，或点击右侧「添加文件」</p>
        <p class="dz-sub">支持 HEIC / HEIF / PNG / JPG / BMP / TIFF / WEBP</p>
      </div>
    </section>

    <section class="controls">
      <div class="ctrl-group">
        <label for="fmt-select">输出格式</label>
        <select id="fmt-select">${OUTPUT_FORMATS
          .map((f) => `<option value="${f}" ${f === "PNG" ? "selected" : ""}>${f}</option>`)
          .join("")}</select>
      </div>
      <div class="ctrl-group">
        <label for="quality">质量 <span id="q-val">90</span></label>
        <input type="range" id="quality" min="1" max="100" value="90" />
      </div>
      <div class="ctrl-group">
        <button id="btn-outdir" class="btn ghost">选择输出目录</button>
        <span id="outdir-label" class="path-label">未选择（默认导出到图片文件夹）</span>
      </div>
      <div class="ctrl-group grow">
        <button id="btn-convert" class="btn primary" disabled>开始转换</button>
      </div>
    </section>

    <section class="table-wrap">
      <table class="file-table">
        <thead>
          <tr>
            <th class="col-idx">#</th>
            <th>文件名</th>
            <th class="col-status">状态</th>
            <th class="col-out">输出</th>
            <th class="col-del"></th>
          </tr>
        </thead>
        <tbody id="tbody"></tbody>
      </table>
      <p id="empty-tip" class="empty-tip">列表为空，请添加图片</p>
    </section>

    <footer class="statusbar">
      <span id="status-text">就绪</span>
      <span id="counter">0 个文件</span>
    </footer>
  </div>
`;

/* ---------- DOM 快捷访问 ---------- */
const $ = <T extends HTMLElement>(sel: string) => app.querySelector(sel) as T;
const tbody = $("#tbody") as HTMLTableSectionElement;
const dropzone = $("#dropzone") as HTMLElement;
const btnOpen = $("#btn-open") as HTMLButtonElement;
const btnClear = $("#btn-clear") as HTMLButtonElement;
const btnConvert = $("#btn-convert") as HTMLButtonElement;
const btnOutdir = $("#btn-outdir") as HTMLButtonElement;
const fmtSelect = $("#fmt-select") as HTMLSelectElement;
const quality = $("#quality") as HTMLInputElement;
const qVal = $("#q-val") as HTMLElement;
const outdirLabel = $("#outdir-label") as HTMLElement;
const statusText = $("#status-text") as HTMLElement;
const counter = $("#counter") as HTMLElement;
const emptyTip = $("#empty-tip") as HTMLElement;

let outDir: string | null = null;

/* ---------- 工具 ---------- */
function isSupported(path: string): boolean {
  const ext = path.split(".").pop()?.toLowerCase() ?? "";
  return SUPPORTED_EXTS.includes(ext);
}

function render() {
  tbody.innerHTML = items
    .map((it, i) => {
      const cls = it.status === "成功" ? "ok" : it.status === "失败" ? "fail" : it.status === "转换中" ? "busy" : "idle";
      return `<tr data-id="${it.id}">
        <td class="col-idx">${i + 1}</td>
        <td class="col-name" title="${escapeHtml(it.path)}">${escapeHtml(it.name)}</td>
        <td class="col-status"><span class="badge ${cls}">${it.status}</span>${
          it.error ? `<div class="err-msg">${escapeHtml(it.error)}</div>` : ""
        }</td>
        <td class="col-out">${it.outputPath ? escapeHtml(basename(it.outputPath)) : "—"}</td>
        <td class="col-del"><button class="del" data-id="${it.id}">×</button></td>
      </tr>`;
    })
    .join("");

  emptyTip.style.display = items.length ? "none" : "block";
  counter.textContent = `${items.length} 个文件 · ${
    items.filter((i) => i.status === "成功").length
  } 成功`;
  btnConvert.disabled = isConverting || items.length === 0;
  btnClear.disabled = isConverting;
}

function basename(p: string): string {
  const parts = p.split(/[/\\]/);
  return parts[parts.length - 1] || p;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!)
  );
}

/* ---------- 添加文件 ---------- */
async function addFiles(paths: string[]) {
  const supported = paths.filter((p) => isSupported(p));
  const unsupportedCount = paths.length - supported.length;
  for (const p of supported) {
    items.push({
      id: nextId++,
      path: p,
      name: basename(p),
      status: "待转换",
      outputPath: null,
      error: null,
    });
  }
  render();
  if (unsupportedCount > 0) {
    statusText.textContent = `已跳过 ${unsupportedCount} 个不支持的格式`;
  } else if (supported.length > 0) {
    statusText.textContent = `已添加 ${supported.length} 个文件`;
  }
}

/* ---------- 事件绑定 ---------- */
btnOpen.addEventListener("click", async () => {
  const { open } = await import("@tauri-apps/plugin-dialog");
  const selected = await open({
    multiple: true,
    filters: [
      {
        name: "图片",
        extensions: SUPPORTED_EXTS,
      },
      { name: "所有文件", extensions: ["*"] },
    ],
  });
  if (selected) {
    const arr = Array.isArray(selected) ? selected : [selected];
    await addFiles(arr);
  }
});

btnClear.addEventListener("click", () => {
  if (isConverting) return;
  items = [];
  render();
  statusText.textContent = "已清空列表";
});

btnOutdir.addEventListener("click", async () => {
  const { open } = await import("@tauri-apps/plugin-dialog");
  const dir = await open({ directory: true, multiple: false });
  if (dir) {
    outDir = Array.isArray(dir) ? dir[0] : dir;
    outdirLabel.textContent = outDir;
    outdirLabel.classList.add("set");
  }
});

quality.addEventListener("input", () => {
  qVal.textContent = quality.value;
});

btnConvert.addEventListener("click", runConvert);

async function runConvert() {
  if (isConverting || items.length === 0) return;
  isConverting = true;
  render();
  statusText.textContent = "转换中…";

  const targetFormat = fmtSelect.value;
  const q = Number(quality.value);

  for (const it of items) {
    if (it.status === "成功") continue;
    it.status = "转换中";
    it.error = null;
    it.outputPath = null;
    render();

    try {
      const res = await invoke<{ success: boolean; outputPath: string | null; error: string | null }>(
        "convert_image",
        {
          req: {
            srcPath: it.path,
            outDir: outDir ?? "",
            targetFormat,
            quality: q,
          },
        }
      );
      if (res.success) {
        it.status = "成功";
        it.outputPath = res.outputPath;
      } else {
        it.status = "失败";
        it.error = res.error ?? "未知错误";
      }
    } catch (e) {
      it.status = "失败";
      it.error = String(e);
    }
    render();
  }

  isConverting = false;
  const failed = items.filter((i) => i.status === "失败").length;
  const ok = items.filter((i) => i.status === "成功").length;
  statusText.textContent = failed ? `转换完成：成功 ${ok}，失败 ${failed}` : `转换完成：全部 ${ok} 张成功`;
  render();
}

/* ---------- 表格行删除 ---------- */
tbody.addEventListener("click", (e) => {
  const btn = (e.target as HTMLElement).closest("button.del");
  if (!btn || isConverting) return;
  const id = Number(btn.getAttribute("data-id"));
  items = items.filter((i) => i.id !== id);
  render();
});

/* ---------- 拖拽 ---------- */
dropzone.addEventListener("dragover", (e) => {
  e.preventDefault();
  dropzone.classList.add("over");
});
dropzone.addEventListener("dragleave", () => dropzone.classList.remove("over"));
dropzone.addEventListener("drop", async (e) => {
  e.preventDefault();
  dropzone.classList.remove("over");
  const files = e.dataTransfer?.files;
  if (!files?.length) return;
  const paths: string[] = [];
  for (const f of Array.from(files)) {
    const p = (f as File & { path?: string }).path;
    if (p) paths.push(p);
  }
  await addFiles(paths);
});

render();