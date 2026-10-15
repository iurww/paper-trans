# Linux release performance audit

This audits the **built application**, including its packaged WebKit, GTK,
JavaScriptCore and launcher. It does not substitute Chromium or a Vite page.
The earlier development-only scripts lived in ignored `tmp/scroll-audit/`;
the maintained release audit now lives here and is tracked by Git.

## Visible desktop acceptance

On an idle Linux desktop with a C compiler, Node.js and the existing npm
dependencies installed:

```bash
python3 tools/performance/run.py /path/to/PaperLens.AppImage \
  --output output/performance/release.json --check desktop
```

The application opens an isolated, synthetic 66-page bilingual paper with
formulas. No API key is used. HOME, application data, cache and the paper
library are temporary; existing documents and settings are not accessed.
The audit instruments the real binary using a small test-only LD_PRELOAD
hook. The application and AppImage bytes are not changed. Test windows
close automatically after the measurements.

AppImages use their bundled libraries; a native executable instead needs its
system WebKitGTK dependencies. The audit log records the actual compositing
policy and graphics environment switches.

Measurements include:

- A continuous 240-frame downward/upward scroll, P50/P95 and longest frame.
- Frames taking over 50 ms, active canvas count and canvas pixel memory.
- Three trials each of new translation, API settings and paper details:
  first visible frame, animation P95 and longest frame.
- PDF rendering errors and explicit completion/error reporting.

The desktop budget targets a visible 60 Hz desktop: scroll P95 <=35 ms,
modal animation P95 <=40 ms, first paint <=160 ms, no stalls over 250 ms,
no more than 2% of scrolling frames over 50 ms, and canvas memory <=256 MiB.
Record display scaling, GPU/driver and desktop session when comparing runs.
Run applications sequentially, keep their windows visible and do not
interact with them during the audit. An offscreen or occluded window does
not provide a trustworthy animation measurement.

Results are JSON; stderr is saved alongside them. The audit exits nonzero
on timeout, missing measurements, PDF errors or failed budget checks.
The budget checker also has unit tests under `tests/performance-budget.test.js`.

## Container/CI smoke test

```bash
PAPERLENS_PERFORMANCE_SMOKE=1 bash tools/build-appimage-docker.sh
```

The optional local smoke test runs the exported AppImage inside the same Ubuntu
toolchain container used by CI. Xvfb/Mesa software rendering uses a relaxed smoke
budget; passing that budget **does not certify NVIDIA/Wayland smoothness**.
The visible-desktop audit is still required to validate GPU performance.
WebKit's sandbox is disabled only for this disposable root-run test container;
normal application launches do not set that option.

CI builds and publishes the package and `appimage-runtime.json`; it does not
run a performance gate. The NVIDIA correction runs in the application before
WebKit initializes; the shared Ubuntu 22.04 toolchain makes that deployment
reproducible. Performance acceptance is performed locally before shipping
changes to that environment.
