# PaperLens 论文翻译工作台

PaperLens 是纯前端的论文翻译工具。网页和 Android 应用均在当前设备解析、排版和保存 PDF，不需要后端或用户账号。用户在「API 设置」中填写自己的 OpenAI 兼容 Chat Completions 地址、模型和 API Key。待翻译的正文会直接发送到该 API；原 PDF、译文 PDF、翻译进度、Token 统计和密钥保存在当前浏览器或应用的本地存储中，不会同步到其他设备。

界面使用 React、Mantine 和 Vite。`src/app/` 管理设置与本地任务状态，`src/components/` 放置任务列表和表单等界面组件，`src/reader/` 负责双栏 PDF 阅读器；`src/pdf.js`、`src/translator.js`、`src/translation-api.js` 和 `src/storage.js` 保持为独立的处理与存储模块。

## 运行网页

```bash
npm install
npm run dev
```

打开终端显示的地址，填写翻译 API 设置，然后上传 PDF。常规模式处理可提取文字的 PDF；纯视觉识别模式可处理扫描版，在 API 设置中另填 DeepSeek API Key。API 需使用 HTTPS 并允许当前网页来源的跨域请求。生产部署只需 `npm run build` 生成的 `dist/` 静态文件，无 Python 服务端。

图表高分辨率提取目前处于[方案验证阶段](docs/figure-extraction-design.md)，尚未接入产品。启动开发服务器后，打开 `/tools/figure-extract.html` 可对新 PDF 逐页试跑提取；打开 `/tools/figure-review.html` 可并排检查当前工作区已有的验证截图与 PDF 原页。

仓库没有 Python 运行时依赖。维护内置 PDF 中文字体所需的 Python 工具由 `uv` 管理：

```bash
uv sync
uv run python tools/verify_font.py
```

`uv sync` 会生成或使用 `uv.lock`，并在 `.venv` 安装开发依赖。新增 Python 工具时也统一使用 `uv`，不使用 `pip` 或手动创建虚拟环境。

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
- 文本提取阶段跳过检测到的公式、表格内容、图内短标签和参考文献；图表标题与 `Note`、`Source` 等脚注会翻译。PDF 中的图像和未覆盖内容保留原貌。识别是基于 PDF 的文字与位置线索，复杂无框表格和非常规公式仍需人工核对。
- PDF 通常只包含公式排版后的字形，不含原始 LaTex 源码。软件保留检测到的行内与行间公式在原 PDF 中的视觉样式，不将它们转换为普通文本。
- 同时只运行一个翻译任务，最多接纳三个待处理任务。正文先按原文段落分组，再按句翻译；译文在原段落宽度内连续排版，两侧按句对应。每次 API 响应都会保存已完成译文与 Token 用量；若批量响应漏掉个别句子，会自动补译。网络中断、限流或暂时性接口故障会自动重试，重新打开页面后继续处理。每篇论文显示进度和 API 返回的输入、输出及总 Token 数。
- 导出 PDF 复用原文件的页面与图片资源，只覆盖需要翻译的文字，并仅嵌入一次中文字体。样本文件从旧版约 26.8 MB 降至约 10.2 MB。中文字体为 [Noto Sans SC](https://github.com/google/fonts/tree/main/ofl/notosanssc)，许可见 `public/fonts/OFL.txt`。

## 纯视觉识别模式

上传 PDF 时在弹窗中选择「纯视觉识别」，任务直接进入视觉流程，不调用常规文本翻译。网页逐页把 PDF 渲染成 JPEG 截图，直接以图片输入发送到 DeepSeek 的 `deepseek-flash` Chat Completions API。所有论文的视觉翻译都跳过表格内部文字和印刷页码；作者姓名、单位、联系信息及参考文献在译文区仅显示一次原文，不显示中文；表格外的标题仍可翻译。提示词要求模型按阅读顺序输出段落 JSON，每段包含 `kind`、`original`（识别出的原语言内容）和 `chinese`（中文译文，作者与参考文献信息为空字符串），公式采用 KaTeX 可解析的 LaTeX：行内公式用 `$...$`，行间及带编号公式用 `$$...\\tag{8}$$`。左侧显示论文原页，右侧按页、按段显示原文和中文；行内及行间公式由 KaTeX 渲染，粗体和斜体按 Markdown 或 LaTeX 强调命令显示。可在阅读栏下载已经完成的对照 JSON。

每完成一页就保存该页的 JSON 和 Token 用量。单页 JSON 不完整时，会提高输出额度，再按阅读顺序分批提取；仍失败则记录该页并继续后面的页面，可单独重试失败页。旧结果中已被过滤的参考文献可在对应页点击顶部「重新识别当前页」恢复。视觉模式与常规译文 PDF 独立保存。文献打开后，顶部模式按钮只切换已有的完整结果；目标模式尚无译文时会提示并保持当前视图，不会因切换而发起另一种翻译。识别质量依赖截图和模型；复杂公式、表格及跨页段落应对照左侧原件核查。原 PDF 的逐页截图会发送给 DeepSeek，普通模式仍使用原有的文本提取和 PDF 排版流程。

常规模式不会自动 OCR。译文过长时可能超出原段落，可双击句子查看完整译文。旧版已完成的逐行译文可在左侧任务列表点击“按句重译”；这会重新请求 API 并产生新的 Token 用量。
