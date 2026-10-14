# PaperLens 论文翻译工作台

PaperLens 是纯前端的论文翻译工具。网页、Linux/macOS 桌面版和 Android 应用均在当前设备解析、排版和保存 PDF，不需要后端或用户账号。用户在「API 设置」中填写自己的 OpenAI 兼容 Chat Completions 地址、模型和 API Key。待翻译的正文会直接发送到该 API；原 PDF、译文 PDF、翻译进度、Token 统计和密钥保存在当前浏览器或应用的本地存储中，不会同步到其他设备。

界面使用 React、Mantine 和 Vite。`src/app/` 管理设置与本地任务状态，`src/components/` 放置任务列表和表单等界面组件，`src/reader/` 负责双栏 PDF 阅读器；`src/pdf/` 负责 PDF 提取与导出，`src/translation/` 管理 API 请求和翻译任务，`src/alignment/` 本地解析句级分隔符与高亮范围，`src/text/` 处理富文本，`src/storage/` 保存本地文档。`src/` 根目录仅保留应用入口 `main.jsx`。

## 运行网页

```bash
npm install
npm run dev
```

打开终端显示的地址，填写翻译 API 设置，然后上传 PDF。常规模式处理可提取文字的 PDF；纯视觉识别模式可处理扫描版，在 API 设置中另填 DeepSeek API Key。API 需使用 HTTPS 并允许当前网页来源的跨域请求。生产部署只需 `npm run build` 生成的 `dist/` 静态文件，无 Python 服务端。

仓库没有 Python 运行时依赖。维护内置 PDF 中文字体所需的 Python 工具由 `uv` 管理：

```bash
uv sync
uv run python tools/verify_font.py
```

`uv sync` 会生成或使用 `uv.lock`，并在 `.venv` 安装开发依赖。新增 Python 工具时也统一使用 `uv`，不使用 `pip` 或手动创建虚拟环境。

## Linux 桌面版（Tauri 2）

Linux 桌面版复用 React 阅读器，使用系统 WebKitGTK，不随应用附带 Chromium 或 Node.js 运行时。Linux 提供 `.deb` 和 AppImage，macOS 提供 DMG。

开发机需要 Node.js/npm、Rust/Cargo、C/C++ 构建工具、`pkg-config`、GTK 3、WebKitGTK 4.1、OpenSSL 和 librsvg。发行版安装命令见 [Tauri 官方前置要求](https://v2.tauri.app/start/prerequisites/)。Manjaro/Arch 可使用：

```bash
sudo pacman -S --needed base-devel rust webkit2gtk-4.1 openssl librsvg
npm ci
npm run linux:dev
```

开发服务器固定使用 `127.0.0.1:1420`，端口占用时会报错。打包命令：

```bash
npm run linux:build
```

产物位于 `src-tauri/target/release/bundle/deb/` 和 `src-tauri/target/release/bundle/appimage/`，独立可执行文件位于 `src-tauri/target/release/paperlens`。AppImage 需设置执行权限；系统缺少 FUSE 时可尝试 `./PaperLens_0.1.0_amd64.AppImage --appimage-extract-and-run`。`.deb` 使用系统运行库，包体更小；AppImage 携带较多运行库，体积更大。

桌面版通过 Tauri 原生 HTTP 插件发送翻译请求，不受浏览器 CORS 限制；支持用户配置的 HTTP/HTTPS 地址。导出 PDF 和 JSON 时使用系统保存对话框，仅写入用户选中的文件。PDF 解析、识别截图与公式显示仍由现有前端完成。

Linux 和 macOS 桌面版（开发启动和正式安装）统一把论文库保存在 `~/Documents/PaperLens/`，暂不支持修改根目录；Linux 也使用该固定路径，不跟随 XDG 文档目录配置。软件内的一级目录对应磁盘上的同名目录，每篇论文一个「原文件名去扩展名--唯一 ID」目录，避免同名论文相互覆盖：

```text
~/Documents/PaperLens/
  default/
    .folder.json
    论文名称--唯一ID/
      original.pdf       # 提交的原件
      translation.json   # 标准/视觉译文、句级对齐、进度及恢复任务所需状态
      metadata.json      # 原文件名、标题、作者、指纹等元信息
      translated.pdf     # 常规模式生成译文 PDF 后保存
```

移动论文会移动其目录，删除论文会删除其目录和文件。JSON 使用临时文件加原子重命名保存。启动时自动迁移当前 WebView 来源下的旧 IndexedDB 论文库，保留旧数据库副本；开发版和正式版分别迁移，之后共用这个文件系统论文库。请避免同时运行两个桌面实例编辑同一论文库。API 设置、密钥和界面偏好仍保存在各自 WebView 的 localStorage，网页与 Android 的论文库仍使用 IndexedDB。退出应用会停止正在进行的请求，重新打开论文后按已保存进度恢复。备份论文库时先退出软件，再复制整个 `~/Documents/PaperLens/`。

本机构建用于当前 Linux 环境试用。Manjaro 上生成的安装包尚不保证能在旧版 Ubuntu/Debian 上运行；正式跨发行版发布应在最低支持的发行版上构建，并验证 WebKitGTK、glibc、X11/Wayland 和 PDF.js 的兼容性。

在 NVIDIA + Wayland 环境下，启动时默认设置 `__NV_DISABLE_EXPLICIT_SYNC=1`，规避显式同步相关的协议错误，同时保留 WebKitGTK 的快速渲染路径；已有同名环境变量时不会覆盖，使用 `GDK_BACKEND=x11` 时也不会设置。其他环境保持默认渲染设置。若特定驱动仍出现白屏、GBM 缓冲创建失败或 `Error 71`，可手动用 `WEBKIT_DISABLE_DMABUF_RENDERER=1` 启动作为兼容回退，但这会影响动画和大文档的图形性能。背景与说明见 [Tauri Linux 图形问题文档](https://v2.tauri.app/develop/debug/linux-graphics/)。

## macOS 桌面版（Tauri 2）

支持 macOS 15 及以上，仅提供 Apple Silicon（arm64）的 DMG。复用系统 WKWebView，不附带 Chromium。当前 PDF.js 使用较新的 WebKit API，因此首版设置 macOS 15 为最低系统版本。

本地构建需要 macOS、Xcode Command Line Tools、Node.js/npm 和 Rust/Cargo：

```bash
xcode-select --install
npm ci
npm run mac:dev
npm run mac:build
```

DMG 位于 `src-tauri/target/release/bundle/dmg/`。平台配置 `src-tauri/tauri.macos.conf.json` 自动合并到共用配置，版本仍统一维护。CI 在 macOS 15 的 Apple Silicon runner 上原生构建。当前使用 ad-hoc 签名，尚未配置 Apple Developer ID 签名和公证，下载后的应用可能被 Gatekeeper 拦截；正式分发签名配置见 [Tauri macOS 签名文档](https://v2.tauri.app/distribute/sign/macos/)。

## 桌面自动更新

macOS 和 Linux 桌面版每次启动自动检查一次 GitHub 最新 Release；设置中的「获取更新」可手动检查。发现新版后显示版本号、发布时间和发布说明，点击「取消」保留当前版本，点击「更新」下载、验证签名、安装并自动重启。无更新或网络不可用不会在启动时打断阅读，手动检查会显示结果或错误。网页和 Android 暂不接入此更新方式。

支持 macOS 应用、Linux AppImage 和 deb。deb 通过更新插件调用系统包管理器，安装时可能需要管理员授权；AppImage 需要其所在目录可写。开发启动可以检查版本，但不会替换开发程序。更新完成前不能关闭更新窗口；失败可重试，安装成功但重启失败时仅重试重启，不重复安装。论文数据仍保存在 `~/Documents/PaperLens/`。

更新端点为 `https://github.com/iurww/paper-trans/releases/latest/download/latest.json`。CI 会上传签名更新包、签名文件和清单；清单内容来自同一个 Release 的版本及说明。新发布的 macOS 使用 `.app.tar.gz`，Linux 按安装类型选择 AppImage 或 deb。签名绑定应用版本，客户端拒绝无效签名和版本不一致的更新包。

本机更新签名私钥在 `.secrets/updater.key`，目录已加入 `.gitignore`；请安全备份并保留同一密钥供后续发布使用。仓库 Actions Secret `TAURI_SIGNING_PRIVATE_KEY` 保存该文件内容；当前生成的私钥使用空密码，无需设置 `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`。公钥已写入 Tauri 配置。打包时必须提供签名密钥，例如：

```bash
TAURI_SIGNING_PRIVATE_KEY_PATH="$PWD/.secrets/updater.key" npm run mac:build
# Linux 使用相同的环境变量运行 npm run linux:build
```

首次启用需手动安装包含此功能的版本，后续发布更高版本即可在应用内更新。不要重新生成或替换已发布版本使用的签名密钥，否则已安装客户端将无法验证后续更新。

## GitHub CI/CD 与版本发布

普通分支推送和 Pull Request 会运行测试及前端构建。推送 `v` 开头的标签后，`.github/workflows/release-desktop.yml` 会并行测试和构建 Linux x86_64 的 `.deb`、AppImage，以及 macOS arm64 的 DMG。所有构建成功后统一发布到该标签对应的 GitHub Release，附带 `SHA256SUMS` 校验文件。构建失败时不会创建 Release；上传完整后才公开新建的 Release。安装包同时保留为 Actions Artifact，保留 14 天。

支持 `vMAJOR.MINOR` 和 `vMAJOR.MINOR.PATCH`，例如 `v0.2` 对应应用版本 `0.2.0`，`v0.2.1` 对应 `0.2.1`。推荐使用三段版本号。不支持前导零、预发布后缀或其他标签格式；不符合规则的 `v*` 标签会直接报错。CI 以标签为版本来源，自动同步 `package.json`、`package-lock.json`、Tauri 配置、Cargo 清单及锁文件，不会把 CI 中的版本修改提交回仓库。

本地可先同步版本并提交，使源码版本与标签一致：

```bash
npm run release:version -- v0.2.0
git add package.json package-lock.json src-tauri/tauri.conf.json src-tauri/Cargo.toml src-tauri/Cargo.lock
git commit -m "chore: release v0.2.0"
git tag -a v0.2.0 -m "PaperLens v0.2.0"
git push origin HEAD
git push origin v0.2.0
```

首次发布前，需要将 Tauri 源码、锁文件和 `.github/workflows/` 一起提交到被打标签的版本。版本已提交时，也可直接打标签并推送；CI 会自动设置安装包版本。发布后使用新标签发布下一版，不移动已有标签。失败后可在 GitHub Actions 中重新运行；重复运行会覆盖同标签下的同名安装包。

工作流使用 GitHub 自带的 `GITHUB_TOKEN` 创建 Release，无需配置模型 API Key 或额外发布令牌。仓库需允许 GitHub Actions 运行，组织策略也需允许工作流的 `contents: write` 权限。这里只发布安装包，尚未实现应用内自动更新。

## Android

安装 Android SDK 和 JDK 21 后运行：

```bash
npm run android:sync
cd android
ANDROID_HOME=/path/to/Android/Sdk ./gradlew assembleDebug
```

调试包位于 `android/app/build/outputs/apk/debug/app-debug.apk`。Android 使用同一套本地处理与存储流程。网页与应用各自保存自己的记录。卸载应用或清除浏览器站点数据会删除本地记录，请下载需要留存的译文 PDF。

## 阅读与翻译范围

- 桌面网页左右连续显示整篇原文和译文。无论光标位置，滚轮都会同步滚动两侧；拖动某一侧的滚动条可单独定位该侧。中间箭头可将另一侧对齐到当前侧。左侧任务列表可折叠，阅读栏只显示当前页数、总页数和缩放按钮。
- PDF.js 根据实际显示宽度与设备像素密度渲染可见页面，放大后重新渲染，不使用固定分辨率的 PNG。
- PDF.js 的 WASM 解码器、CMap 字符映射、标准备用字体和 ICC 配置随应用一起打包，开发服务器与安装包使用相同资源路径，不依赖在线字体/CDN。
- 文本提取阶段跳过检测到的公式、表格内容、图内短标签和参考文献；图表标题与 `Note`、`Source` 等脚注会翻译。PDF 中的图像和未覆盖内容保留原貌。识别是基于 PDF 的文字与位置线索，复杂无框表格和非常规公式仍需人工核对。
- PDF 通常只包含公式排版后的字形，不含原始 LaTex 源码。软件保留检测到的行内与行间公式在原 PDF 中的视觉样式，不将它们转换为普通文本。
- 同时只运行一个翻译任务，最多接纳三个待处理任务。正文先按原文段落分组，再按句翻译；译文在原段落宽度内连续排版，两侧按句对应。每次 API 响应都会保存已完成译文与 Token 用量；若批量响应漏掉个别句子，会自动补译。网络中断、限流或暂时性接口故障会自动重试，重新打开页面后继续处理。每篇论文显示进度和 API 返回的输入、输出及总 Token 数。
- 导出 PDF 复用原文件的页面与图片资源，只覆盖需要翻译的文字，并仅嵌入一次中文字体。样本文件从旧版约 26.8 MB 降至约 10.2 MB。中文字体为 [Noto Sans SC](https://github.com/google/fonts/tree/main/ofl/notosanssc)，许可见 `public/fonts/OFL.txt`。

## 纯视觉识别模式

上传 PDF 时在弹窗中选择「纯视觉识别」，任务直接进入视觉流程，不调用常规文本翻译。网页逐页把 PDF 渲染成 JPEG 截图，直接以图片输入发送到 DeepSeek 的 `deepseek-flash` Chat Completions API。所有论文的视觉翻译都跳过表格内部文字和印刷页码；作者姓名、单位、联系信息及参考文献在译文区仅显示一次原文，不显示中文；表格外的标题仍可翻译。提示词要求模型按阅读顺序输出段落 JSON，每段包含 `kind`、`original`（识别出的原语言内容）和 `chinese`（中文译文，作者与参考文献信息为空字符串），公式采用 KaTeX 可解析的 LaTeX：行内公式用 `$...$`，行间及带编号公式用 `$$...\\tag{8}$$`。左侧显示论文原页，右侧按页、按段显示原文和中文；行内及行间公式由 KaTeX 渲染，粗体和斜体按 Markdown 或 LaTeX 强调命令显示。可在阅读栏下载已经完成的对照 JSON。

每完成一页就保存该页的 JSON 和 Token 用量。单页 JSON 不完整时，会提高输出额度，再按阅读顺序分批提取；仍失败则记录该页并继续后面的页面，可单独重试失败页。旧结果中已被过滤的参考文献可在对应页点击顶部「重新识别当前页」恢复。视觉模式与常规译文 PDF 独立保存。文献打开后，顶部模式按钮只切换已有的完整结果；目标模式尚无译文时会提示并保持当前视图，不会因切换而发起另一种翻译。识别质量依赖截图和模型；复杂公式、表格及跨页段落应对照左侧原件核查。原 PDF 的逐页截图会发送给 DeepSeek，普通模式仍使用原有的文本提取和 PDF 排版流程。

### 视觉译文的句级对照

视觉识别在同一次图片请求中完成句级对应，不再发送第二轮文本对齐请求。段落 JSON 仍为 `kind`、`original`、`chinese`，旧版 UUID 分隔符仍可读取。双语字符串使用专用保留符号 `[[[s:7e9c2a]]]` 分隔语义句组。两侧组数必须一致，第 n 组互相对应；原文逐句、独立列表项逐项分隔，公式引导短句另成一组，翻译某个原句时的拆句保留在同一组。默认启用 DeepSeek 思考模式以提高分句指令遵循，响应时间及输出 token 会增加。专用命名空间符号按完整字符串精确解析，普通 `[[[sep]]]` 不会被识别为边界。

网页隐藏符号，在规范化后的显示文本上生成 UTF-16 范围，悬停任一语言时同时高亮对应句组，保留公式和强调格式。若边界数量不匹配、存在空组或切入公式等无效位置，则仅该段退回整段对应，不为对齐追加 API 请求。截图请求本身的网络重试与截断恢复仍保留。每页返回后即可显示句级高亮。

旧记录已有且仍匹配的句级映射继续使用；没有分隔符或映射的旧段落使用整段对应。可点击「重新识别当前页」通过新的图片翻译生成分隔符。逐段 JSON 下载保留分隔符；句级对照 JSON 下载包含去掉分隔符后的显示文本快照、句子范围及 `links`，整段回退项标注 `granularity: "paragraph"`。无中文对应的作者、参考文献及独立公式不参与句级配对。

常规模式不会自动 OCR。译文过长时可能超出原段落，可双击句子查看完整译文。旧版已完成的逐行译文可在左侧任务列表点击“按句重译”；这会重新请求 API 并产生新的 Token 用量。

### PDF 内容缺失排查

左侧原件视图渲染上传文件的完整页面，不会按翻译规则隐藏正文、图表或参考文献。若左右两侧都只有少量图注，请先在独立 PDF 阅读器中打开实际上传的文件，核对完整文件名与页数。文件名包含 `figures_only` 等标记的图表摘录通常没有论文正文，需要重新导入完整论文；重新识别无法恢复源文件中不存在的内容。

常规模式只翻译可提取文字的正文等内容，参考文献保留原样；遇到 `Appendix`、`Appendices` 或“附录”标题后会退出参考文献过滤，继续处理附录。纯图片 PDF 应选择纯视觉识别模式。已有常规翻译记录若漏掉附录，需要重新翻译才能生成更新后的结果。

### 视觉句级协议实测

`tools/verify-vision-sentences.mjs` 使用生产代码的 `translateVisualPage` 与 `separatorAlignment`，通过 Poppler 将指定 PDF 页渲染为截图，保存逐段翻译 JSON、API 内容/用量、显示范围及统计。需要本机 `pdftoppm` 和 `.env` 或环境变量中的 `DEEPSEEK_API_KEY`；不会保存 API Key 或模型内部思考内容。

```bash
node tools/verify-vision-sentences.mjs samples.json output/vision-check disabled,enabled
```

`samples.json` 为 `[{"id":"sample-p1","pdf":"/path/to/paper.pdf","page":1}]`。可只传 `enabled` 或 `disabled` 对同一提示词复测；已有 summary 的样本会跳过，独立复测须使用新的输出目录。统计中的 `suspectUnsplit` 只是人工检查候选，编号、缩写、原文相同的引用项可能误报，数量相等也不能代替语义审核。

### Android v0.3.0

安卓端仅提供纯视觉翻译阅读视图，显示识别后的原文与中文段落，不加载原件 PDF 阅读面板或模式切换。通过「我的文献」管理目录、上传和删除论文；新建翻译需要选择保存目录。API Key 与桌面端设置一致，原生 HTTP 请求避免 WebView 跨域限制。

本机安装 JDK 21 和 Android SDK 35 后，配置 `ANDROID_HOME`，运行 `npm run android:build`。可安装的测试 APK 位于 `android/app/build/outputs/apk/debug/app-debug.apk`。安卓版本号从 `package.json` 读取。

推送 `v*` 标签会同时构建桌面安装包和 `PaperLens-vX.Y.Z-android-debug.apk`，上传至 GitHub Release 并生成校验和。APK 使用 debug 签名，适合直接安装测试；不同构建环境的 debug 签名可能不同，升级时若签名不匹配需先卸载（会删除本机数据）。正式分发版本仍需配置稳定的发布签名。
