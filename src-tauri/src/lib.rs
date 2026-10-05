//! Tauri 应用入口，注册转换命令。

mod converter;

use converter::{ConvertRequest, ConvertResponse};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![convert_image])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

/// 前端调用的转换命令。
#[tauri::command]
fn convert_image(req: ConvertRequest) -> ConvertResponse {
    converter::convert(req)
}