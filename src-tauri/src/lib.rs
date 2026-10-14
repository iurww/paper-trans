#[tauri::command]
fn update_environment() -> serde_json::Value {
    let development = cfg!(debug_assertions);
    let supported = cfg!(target_os = "macos") || cfg!(target_os = "linux");
    serde_json::json!({
        "canInstall": !development && supported,
        "reason": if development {
            "开发启动仅检查更新，请在正式安装版中更新。"
        } else if !supported {
            "当前平台暂不支持桌面自动更新。"
        } else { "" }
    })
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .invoke_handler(tauri::generate_handler![update_environment])
        .setup(|app| {
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while building tauri application");
}
