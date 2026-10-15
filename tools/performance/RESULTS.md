# NVIDIA release regression: 2026-10-15

Hardware: NVIDIA RTX 4070 SUPER, driver 610.57.04, desktop scale 2x.
Workload: the audit's isolated synthetic 66-page bilingual PDF with formulas.
Values below are frame intervals/latencies in milliseconds, not FPS.

| Actual application/runtime | Scroll P95 | Settings animation P95 (3 trials) |
| --- | ---: | ---: |
| Published v0.3.4 AppImage, bundled Ubuntu WebKitGTK 2.50.4 | 96–128 | 127–136 |
| Same v0.3.4 executable, system Manjaro WebKitGTK 2.52.6 | 20–23 | 19–34 |
| Docker Ubuntu 24.04 AppImage, WebKitGTK 2.52.6, no NVIDIA correction | 45–46 | 54–58 |
| Original v0.3.4 AppImage with `WEBKIT_FORCE_DMABUF_RENDERER=1` | 26 | 19–21 |
| Final local Docker v0.3.5, Ubuntu 22.04, normal Wayland launch | 27 | 19–22 |
| Final local Docker v0.3.5, Ubuntu 22.04, `GDK_BACKEND=x11` only | 27 | 23–25 |

The two final launches needed no manual WebKit/NVIDIA environment switches.
Both completed the desktop budget with zero scroll frames above 50 ms,
four active PDF canvases (about 16.4 MiB), and no PDF rendering errors.
New-translation first-paint latency was 67–92 ms on Wayland and 64–102 ms
on X11; its animation P95 was 18–40 ms and 20–40 ms respectively.
Paper-details animation P95 was 17–24 ms and 17–26 ms respectively.

## Root cause

Ubuntu/Debian applies `debian/patches/disable-nvidia-dmabuf.patch` to WebKitGTK.
The patch detects the NVIDIA GL vendor and returns without enabling the
accelerated buffer transport, unless `WEBKIT_FORCE_DMABUF_RENDERER` is set.
The audit read `hardware_acceleration_policy=2` (NEVER) in the affected
AppImage and `1` (ALWAYS) after the correction. Merely upgrading WebKitGTK
did not bypass this distribution patch.

The original application optimization set `__NV_DISABLE_EXPLICIT_SYNC=1`
on Wayland but did not bypass this separate NVIDIA blacklist. v0.3.5 now
sets the DMABUF override before GTK/WebKit initialization, without overriding
explicit user values. X11/XWayland also defaults to shared-memory buffer
transport to avoid NVIDIA GBM allocation failures while retaining accelerated
compositing. The Ubuntu 22.04 compatibility baseline is preserved.

Raw local records are written under `output/performance/` (not committed).
These results describe the local Docker candidate. The release procedure
additionally downloads the signed GitHub Actions artifact, verifies its
checksum, and repeats the visible-desktop audit against that file.
