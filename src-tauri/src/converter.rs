//! 图片转换核心逻辑。
//!
//! 策略：
//! - HEIC/HEIF：macOS 用系统 `sips`；其他平台用 libheif-rs 解码为临时 PNG。
//! - 其他格式：直接用 image crate 解码再编码。
//! macOS 走系统原生链路（已验证无损），Windows/Linux 走 libheif（通过 vcpkg 提供）。
use std::fs;
use std::io::BufWriter;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};

use image::codecs::jpeg::JpegEncoder;
use image::{DynamicImage, ImageFormat, RgbImage, RgbaImage};

use serde::{Deserialize, Serialize};

/// 前端提交的转换请求。
#[derive(Debug, Deserialize)]
pub struct ConvertRequest {
    /// 输入文件绝对路径
    pub src_path: String,
    /// 输出目录；为空时默认输出到源文件所在目录
    pub out_dir: String,
    /// 目标格式：PNG / JPEG / BMP / TIFF / WEBP
    pub target_format: String,
    /// 有损格式质量 1-100（JPEG 生效，WebP 使用无损）
    pub quality: u8,
}

/// 返回给前端的结果。
#[derive(Debug, Serialize)]
pub struct ConvertResponse {
    pub success: bool,
    pub output_path: Option<String>,
    pub error: Option<String>,
}

static TEMP_COUNTER: AtomicU64 = AtomicU64::new(0);

#[derive(Debug)]
enum Target {
    Png,
    Jpeg,
    Bmp,
    Tiff,
    Webp,
}

impl Target {
    fn parse(name: &str) -> Option<Self> {
        match name.to_ascii_uppercase().as_str() {
            "PNG" => Some(Self::Png),
            "JPEG" | "JPG" => Some(Self::Jpeg),
            "BMP" => Some(Self::Bmp),
            "TIFF" => Some(Self::Tiff),
            "WEBP" => Some(Self::Webp),
            _ => None,
        }
    }

    fn extension(&self) -> &'static str {
        match self {
            Self::Png => "png",
            Self::Jpeg => "jpg",
            Self::Bmp => "bmp",
            Self::Tiff => "tiff",
            Self::Webp => "webp",
        }
    }

    fn image_format(&self) -> ImageFormat {
        match self {
            Self::Png => ImageFormat::Png,
            Self::Jpeg => ImageFormat::Jpeg,
            Self::Bmp => ImageFormat::Bmp,
            Self::Tiff => ImageFormat::Tiff,
            Self::Webp => ImageFormat::WebP,
        }
    }
}

fn ext_of(path: &Path) -> String {
    path.extension()
        .and_then(|e| e.to_str())
        .map(|s| s.to_ascii_lowercase())
        .unwrap_or_default()
}

fn is_heic(path: &Path) -> bool {
    matches!(ext_of(path).as_str(), "heic" | "heif")
}

/// 生成临时 PNG 文件路径（每次调用唯一）。
fn temp_png_path() -> PathBuf {
    let n = TEMP_COUNTER.fetch_add(1, Ordering::Relaxed);
    std::env::temp_dir().join(format!("picconv_{}_{}.png", std::process::id(), n))
}

/// macOS：调用系统自带 `sips` 把 HEIC 解码为临时 PNG。
#[cfg(target_os = "macos")]
fn decode_heic(src: &Path) -> Result<PathBuf, String> {
    use std::process::Command;

    let tmp = temp_png_path();
    let output = Command::new("sips")
        .args(["-s", "format", "png", "-Z", "20000"])
        .arg(src)
        .arg("--out")
        .arg(&tmp)
        .output()
        .map_err(|e| format!("无法调用 sips：{e}"))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("sips 解码失败：{}", stderr.trim()));
    }
    if !tmp.exists() {
        return Err("sips 未生成输出文件".into());
    }
    Ok(tmp)
}

/// 其他平台（Windows/Linux）：用 libheif-rs 解码 HEIC 为临时 PNG。
#[cfg(not(target_os = "macos"))]
fn decode_heic(src: &Path) -> Result<PathBuf, String> {
    use libheif_rs::{ColorSpace, HeifContext, LibHeif, RgbChroma};

    let path_str = src
        .to_str()
        .ok_or_else(|| "路径包含无效字符".to_string())?;

    let ctx = HeifContext::read_from_file(path_str)
        .map_err(|e| format!("打开 HEIC 失败：{e}"))?;
    let handle = ctx
        .primary_image_handle()
        .map_err(|e| format!("读取 HEIC 图像句柄失败：{e}"))?;
    let lib = LibHeif::new();
    let image = lib
        .decode(&handle, ColorSpace::Rgb(RgbChroma::Rgba), None)
        .map_err(|e| format!("解码 HEIC 像素失败：{e}"))?;

    let planes = image.planes();
    let plane = planes
        .interleaved
        .ok_or_else(|| "HEIC 解码结果无交错像素数据".to_string())?;

    let width = plane.width as u32;
    let height = plane.height as u32;

    // RGBA：每像素 4 字节
    let mut rgba = RgbaImage::new(width, height);
    for y in 0..height {
        let row_off = (y as usize) * plane.stride;
        for x in 0..width {
            let idx = row_off + (x as usize) * 4;
            if idx + 3 < plane.data.len() {
                rgba.put_pixel(
                    x,
                    y,
                    image::Rgba([
                        plane.data[idx],
                        plane.data[idx + 1],
                        plane.data[idx + 2],
                        plane.data[idx + 3],
                    ]),
                );
            }
        }
    }

    let tmp = temp_png_path();
    rgba.save(&tmp)
        .map_err(|e| format!("保存 HEIC 解码结果失败：{e}"))?;
    Ok(tmp)
}

/// 把 RGBA 图合成到白底，用于不支持透明的输出格式（返回不透明 RGB）。
fn flatten_to_rgb(img: &RgbaImage) -> RgbImage {
    let mut out = RgbImage::new(img.width(), img.height());
    for (x, y, px) in img.enumerate_pixels() {
        let a = px[3] as f32 / 255.0;
        let blend = |c: u8| -> u8 {
            (c as f32 * a + 255.0 * (1.0 - a)).round() as u8
        };
        out.put_pixel(x, y, image::Rgb([blend(px[0]), blend(px[1]), blend(px[2])]));
    }
    out
}

/// 加载源图为 DynamicImage。
fn load_source(src: &Path) -> Result<DynamicImage, String> {
    if is_heic(src) {
        let tmp = decode_heic(src)?;
        let result = image::open(&tmp).map_err(|e| format!("读取 HEIC 解码结果失败：{e}"));
        let _ = fs::remove_file(&tmp);
        result
    } else {
        image::open(src).map_err(|e| format!("无法解码图片：{e}"))
    }
}

/// 保存 DynamicImage 到目标格式。
fn save_image(
    img: &DynamicImage,
    path: &Path,
    target: &Target,
    quality: u8,
) -> Result<(), String> {
    match target {
        Target::Jpeg => {
            // JPEG 不支持透明，先合成白底并转为 RGB8
            let rgb = flatten_to_rgb(&img.to_rgba8());
            let file = fs::File::create(path).map_err(|e| format!("无法创建输出文件：{e}"))?;
            let mut writer = BufWriter::new(file);
            let encoder = JpegEncoder::new_with_quality(&mut writer, quality.clamp(1, 100));
            rgb.write_with_encoder(encoder)
                .map_err(|e| format!("JPEG 编码失败：{e}"))
        }
        Target::Bmp => {
            // BMP 不支持透明，转为 RGB8
            let rgb = flatten_to_rgb(&img.to_rgba8());
            rgb.save_with_format(path, ImageFormat::Bmp)
                .map_err(|e| format!("BMP 编码失败：{e}"))
        }
        _ => img
            .save_with_format(path, target.image_format())
            .map_err(|e| format!("编码失败：{e}")),
    }
}

/// 执行一次转换。
pub fn convert(req: ConvertRequest) -> ConvertResponse {
    match convert_inner(&req) {
        Ok(out_path) => ConvertResponse {
            success: true,
            output_path: Some(out_path.to_string_lossy().into_owned()),
            error: None,
        },
        Err(e) => ConvertResponse {
            success: false,
            output_path: None,
            error: Some(e),
        },
    }
}

fn convert_inner(req: &ConvertRequest) -> Result<PathBuf, String> {
    let src = PathBuf::from(&req.src_path);
    if !src.is_file() {
        return Err(format!("文件不存在：{}", src.display()));
    }

    let target = Target::parse(&req.target_format)
        .ok_or_else(|| format!("不支持的输出格式：{}", req.target_format))?;

    // 决定输出目录
    let out_dir = if req.out_dir.trim().is_empty() {
        src.parent()
            .map(|p| p.to_path_buf())
            .ok_or_else(|| "无法确定输出目录".to_string())?
    } else {
        let d = PathBuf::from(&req.out_dir);
        fs::create_dir_all(&d).map_err(|e| format!("无法创建输出目录：{e}"))?;
        d
    };

    // 生成输出路径（同名换扩展名）
    let stem = src
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("output");
    let out_path = out_dir.join(format!("{stem}.{}", target.extension()));

    // 加载源图
    let img = load_source(&src)?;

    // 保存
    save_image(&img, &out_path, &target, req.quality)?;

    Ok(out_path)
}