fn main() {
    // Ubuntu/Debian's WebKit package disables DMABUF for NVIDIA by default,
    // even on modern drivers. Restore its accelerated path (including X11),
    // while preserving explicit user overrides and WebKit's capability checks.
    // https://v2.tauri.app/develop/debug/linux-graphics/
    #[cfg(target_os = "linux")]
    if std::path::Path::new("/sys/module/nvidia").exists() {
        if std::env::var_os("WEBKIT_FORCE_DMABUF_RENDERER").is_none() {
            // SAFETY: before Tauri, GTK, or application threads start.
            unsafe { std::env::set_var("WEBKIT_FORCE_DMABUF_RENDERER", "1") };
        }
        if (std::env::var("GDK_BACKEND").as_deref() == Ok("x11")
            || std::env::var("XDG_SESSION_TYPE").as_deref() == Ok("x11"))
            && std::env::var_os("WEBKIT_DMABUF_RENDERER_FORCE_SHM").is_none()
        {
            // NVIDIA GBM buffers can fail under X11/XWayland. Keep accelerated
            // compositing but transfer its buffers through shared memory.
            // SAFETY: before Tauri, GTK, or application threads start.
            unsafe { std::env::set_var("WEBKIT_DMABUF_RENDERER_FORCE_SHM", "1") };
        }
        if std::env::var("GDK_BACKEND").as_deref() != Ok("x11")
            && (std::env::var_os("WAYLAND_DISPLAY").is_some()
                || std::env::var("XDG_SESSION_TYPE").as_deref() == Ok("wayland"))
            && std::env::var_os("__NV_DISABLE_EXPLICIT_SYNC").is_none()
        {
            // SAFETY: before Tauri, GTK, or application threads start.
            unsafe { std::env::set_var("__NV_DISABLE_EXPLICIT_SYNC", "1") };
        }
    }
    app_lib::run();
}
