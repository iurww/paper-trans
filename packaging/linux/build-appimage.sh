#!/usr/bin/env bash
set -euo pipefail

# Runs inside the toolchain container. Never copy credentials or host build
# products: a fresh AppDir is essential to reproducible library deployment.
tar -C /source --exclude=.git --exclude=.env --exclude=.secrets --exclude=.aws --exclude=.codex --exclude=.agents \
  --exclude=node_modules --exclude=dist --exclude=src-tauri/target \
  --exclude=tmp --exclude=output --exclude=downloads --exclude=.venv \
  --exclude=android/.gradle --exclude=android/build --exclude=android/app/build \
  -cf - . | tar -C /work -xf -
if [[ -n "${RELEASE_TAG:-}" ]]; then node tools/release-version.mjs "$RELEASE_TAG"; fi
npm ci
npm test
rm -rf src-tauri/target/release/bundle/appimage
if [[ -n "${TAURI_SIGNING_PRIVATE_KEY:-}" ]]; then
  npm exec tauri build -- --bundles appimage --ci -- --locked
else
  npm exec tauri build -- --bundles appimage --ci \
    --config '{"bundle":{"createUpdaterArtifacts":false}}' -- --locked
fi
# Check what is actually deployed, not just the development package version.
python3 - <<'PY'
import ctypes
from pathlib import Path
library = Path('src-tauri/target/release/bundle/appimage/PaperLens.AppDir/usr/lib/libwebkit2gtk-4.1.so.0')
webkit = ctypes.CDLL(str(library.resolve()))
version = tuple(getattr(webkit, f'webkit_get_{part}_version')() for part in ('major', 'minor', 'micro'))
print('Bundled WebKitGTK:', '.'.join(map(str, version)))
PY
mkdir -p /exports
for image in src-tauri/target/release/bundle/appimage/*.AppImage; do
  artifact="/exports/$(basename "$image")"
  cp "$image" "$artifact.next"
  mv -f "$artifact.next" "$artifact"
done
if [[ -n "${TAURI_SIGNING_PRIVATE_KEY:-}" ]]; then
  cp src-tauri/target/release/bundle/appimage/*.AppImage.sig /exports/
fi
node -e '
  const { execFileSync: run } = require("node:child_process");
  const version = p => run("pkg-config", ["--modversion", p], { encoding: "utf8" }).trim();
  const record = { application: require("./package.json").version, commit: process.env.SOURCE_COMMIT,
    base: "ubuntu:22.04", webkit: version("webkit2gtk-4.1"), gtk: version("gtk+-3.0"),
    javascriptcore: version("javascriptcoregtk-4.1"),
    glibc: run("getconf", ["GNU_LIBC_VERSION"], { encoding: "utf8" }).trim(),
    rustc: run("rustc", ["--version"], { encoding: "utf8" }).trim(),
    node: process.version };
  require("node:fs").writeFileSync("/exports/appimage-runtime.json", JSON.stringify(record, null, 2) + "\n");
'
if [[ "${PAPERLENS_PERFORMANCE_SMOKE:-0}" == 1 ]]; then
  # Software rendering validates the actual package in CI; its relaxed budget
  # must not be confused with the separate visible-desktop acceptance budget.
  WEBKIT_DISABLE_SANDBOX_THIS_IS_DANGEROUS=1 LIBGL_ALWAYS_SOFTWARE=1 GDK_BACKEND=x11 \
    xvfb-run -a -s '-screen 0 1280x820x24' dbus-run-session -- \
    python3 tools/performance/run.py "$artifact" \
      --output /exports/appimage-performance.json --check software
fi
chown -R "${EXPORT_UID:-0}:${EXPORT_GID:-0}" /exports
