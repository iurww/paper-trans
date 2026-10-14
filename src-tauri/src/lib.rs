#[tauri::command]
fn update_environment() -> serde_json::Value {
    let development = cfg!(debug_assertions);
    // Native Arch packages are managed by pacman; the Tauri updater does not
    // implement pacman installation and would otherwise select the AppImage.
    let pacman = cfg!(target_os = "linux")
        && std::env::current_exe()
            .ok()
            .and_then(|exe| {
                exe.parent()
                    .and_then(|bin| bin.parent())
                    .map(|prefix| prefix.join("share/paperlens/package-format"))
            })
            .and_then(|path| std::fs::read_to_string(path).ok())
            .is_some_and(|format| format.trim() == "pacman");
    let supported = cfg!(target_os = "macos") || cfg!(target_os = "linux");
    serde_json::json!({
        "canInstall": !development && supported && !pacman,
        "reason": if development {
            "开发启动仅检查更新，请在正式安装版中更新。"
        } else if pacman {
            "Arch Linux 安装包请使用 pacman -U 安装新版 .pkg.tar.zst；此版本支持检查更新，暂不支持应用内安装。"
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
