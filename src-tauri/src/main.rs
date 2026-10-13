fn main() {
    // Keep WebKitGTK's accelerated renderer on NVIDIA/Wayland. Disabling DMABUF
    // avoids driver crashes but makes animations and large documents much slower.
    // https://v2.tauri.app/develop/debug/linux-graphics/
    #[cfg(target_os = "linux")]
    if std::path::Path::new("/sys/module/nvidia").exists()
        && std::env::var("GDK_BACKEND").as_deref() != Ok("x11")
        && (std::env::var_os("WAYLAND_DISPLAY").is_some()
            || std::env::var("XDG_SESSION_TYPE").as_deref() == Ok("wayland"))
        && std::env::var_os("__NV_DISABLE_EXPLICIT_SYNC").is_none()
    {
        // SAFETY: this runs before Tauri, GTK, or any application threads start.
        unsafe { std::env::set_var("__NV_DISABLE_EXPLICIT_SYNC", "1") };
    }
    app_lib::run();
}
