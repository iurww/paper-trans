// Test-only LD_PRELOAD hook: instrument the actual release binary without
// recompiling it or adding benchmark entry points to the application.
#define _GNU_SOURCE
#include <dlfcn.h>
#include <stdio.h>
#include <stdlib.h>

static void loaded(void *view, int event, void *unused) {
  (void)unused;
  if (event != 3) return; // WEBKIT_LOAD_FINISHED
  const char *variables[] = { "WEBKIT_DISABLE_COMPOSITING_MODE", "WEBKIT_DISABLE_DMABUF_RENDERER", "WEBKIT_FORCE_DMABUF_RENDERER", "WEBKIT_DMABUF_RENDERER_FORCE_SHM", "WEBKIT_FORCE_COMPOSITING_MODE", "LIBGL_ALWAYS_SOFTWARE", "__NV_DISABLE_EXPLICIT_SYNC" };
  for (int i = 0; i < 7; i++) fprintf(stderr, "[performance] %s=%s\n", variables[i], getenv(variables[i]) ?: "<unset>");
  void *(*get_settings)(void *) = dlsym(RTLD_DEFAULT, "webkit_web_view_get_settings");
  const char *properties[] = { "enable_2d_canvas_acceleration", "hardware_acceleration_policy", "enable_webgl" };
  if (get_settings) {
    void *settings = get_settings(view);
    for (int i = 0; i < 3; i++) {
      char symbol[128];
      snprintf(symbol, sizeof symbol, "webkit_settings_get_%s", properties[i]);
      int (*get)(void *) = dlsym(RTLD_DEFAULT, symbol);
      if (get) fprintf(stderr, "[performance] %s=%d\n", properties[i], get(settings));
    }
  }
  const char *path = getenv("PAPERLENS_AUDIT_SCRIPT");
  if (!path) return;
  FILE *file = fopen(path, "rb");
  if (!file) return;
  fseek(file, 0, SEEK_END);
  long length = ftell(file);
  rewind(file);
  char *script = calloc((size_t)length + 1, 1);
  if (!script) { fclose(file); return; }
  size_t count = fread(script, 1, (size_t)length, file);
  fclose(file);
  if (count == (size_t)length) {
    void (*evaluate)(void *, const char *, long, const char *, const char *, void *, void *, void *) =
      dlsym(RTLD_DEFAULT, "webkit_web_view_evaluate_javascript");
    if (evaluate) evaluate(view, script, -1, NULL, NULL, NULL, NULL, NULL);
  }
  free(script);
}

void webkit_web_view_load_uri(void *view, const char *uri) {
  unsigned long (*connect_signal)(void *, const char *, void *, void *, void *, int) =
    dlsym(RTLD_DEFAULT, "g_signal_connect_data");
  void (*original)(void *, const char *) = dlsym(RTLD_NEXT, "webkit_web_view_load_uri");
  connect_signal(view, "load-changed", loaded, NULL, NULL, 0);
  original(view, uri);
}
