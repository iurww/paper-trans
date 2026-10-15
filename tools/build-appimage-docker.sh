#!/usr/bin/env bash
set -euo pipefail
root="$(cd "$(dirname "$0")/.." && pwd)"
destination="${1:-$root/output/docker-appimage}"
mkdir -p "$destination"
destination="$(cd "$destination" && pwd)"
image=paperlens-appimage:ubuntu22
if [[ -n "${TAURI_SIGNING_PRIVATE_KEY:-}" && -f "$TAURI_SIGNING_PRIVATE_KEY" ]]; then
  # The host path does not exist inside the container. Pass key contents via
  # the environment, just as GitHub Actions does, never via a copied source file.
  export TAURI_SIGNING_PRIVATE_KEY="$(cat "$TAURI_SIGNING_PRIVATE_KEY")"
fi
if [[ "${PAPERLENS_TOOLCHAIN_READY:-0}" != 1 ]]; then
  docker build --build-arg "APT_MIRROR=${PAPERLENS_APT_MIRROR:-}" \
    --build-arg "RUST_IMAGE=${PAPERLENS_RUST_IMAGE:-rust:1.99.0-slim-bookworm}" \
    --tag "$image" --file "$root/packaging/linux/Dockerfile.appimage" "$root/packaging/linux"
fi
docker run --rm \
  --mount "type=bind,source=$root,target=/source,readonly" \
  --mount "type=bind,source=$destination,target=/exports" \
  --mount type=volume,source=paperlens-cargo-registry,target=/root/.cargo/registry \
  --mount type=volume,source=paperlens-cargo-git,target=/root/.cargo/git \
  --mount type=volume,source=paperlens-appimage-target,target=/work/src-tauri/target \
  --mount type=volume,source=paperlens-npm-cache,target=/root/.npm \
  --mount type=volume,source=paperlens-tauri-cache,target=/root/.cache/tauri \
  --env TAURI_SIGNING_PRIVATE_KEY --env TAURI_SIGNING_PRIVATE_KEY_PASSWORD \
  --env PAPERLENS_PERFORMANCE_SMOKE \
  --env RELEASE_TAG --env "SOURCE_COMMIT=$(git -C "$root" rev-parse HEAD)" \
  --env "EXPORT_UID=$(id -u)" --env "EXPORT_GID=$(id -g)" \
  "$image" bash /source/packaging/linux/build-appimage.sh
