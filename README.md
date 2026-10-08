# PaperLens 论文翻译工作台

上传可提取文字的 PDF 后，PaperLens 使用 DeepSeek API 按句翻译，并把译文放回原论文的文本位置。网页版左右展示原文与译文，鼠标移到一句话上时两侧同步高亮。手机 APK 只展示原文，点击段落会弹出完整译文。原文、译文 PDF、句段对照数据和翻译记录保存在后端的 `data/` 目录。翻译中途失败时，点击「继续翻译」会从已保存的进度点恢复。

## 运行网页版与后端

```bash
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt
npm install
npm run build
```

将 `.env.example` 复制为 `.env`，设置 `DEEPSEEK_API_KEY`。本工作区已经配置了用户提供的密钥；`.env` 被 Git 忽略，不会进入 APK。Linux 上如没有 `/usr/share/fonts/sarasa-gothic/Sarasa-Regular.ttc`，请在 `.env` 中设置 `PAPERLENS_FONT` 为一个支持中文的 TTF/TTC 字体路径。

```bash
.venv/bin/uvicorn backend:app --host 127.0.0.1 --port 8000
```

浏览器打开 `http://127.0.0.1:8000`。手机要连接同一个局域网时，把启动参数改成 `--host 0.0.0.0`，并在 APK 的「服务器设置」中输入电脑的局域网地址，例如 `http://192.168.1.20:8000`。后端目前没有账号登录功能，建议仅在可信局域网内使用。

开发前端时可以运行 `npm run dev`，但正式网页由后端直接提供 `dist/` 中的文件。

## Android APK

本仓库包含 Capacitor Android 工程。安装 Android SDK 和 JDK 21 后运行：

```bash
npm run android:sync
cd android
ANDROID_HOME=/path/to/Android/Sdk ./gradlew assembleDebug
```

生成的调试安装包位于 `android/app/build/outputs/apk/debug/app-debug.apk`。它是可安装的 debug APK；公开分发需要另行配置正式签名。APK 仅含界面，翻译、文件与历史记录仍由上述后端提供，手机需要能访问后端。

## 版式边界

- 页面尺寸及图片、表格、绘图的位置保留；可提取的文本在原有区域内替换。长译文可能需要缩小字号。若仍放不下，网页会提示，完整译文保存在句段数据中。
- 扫描版 PDF、嵌在图片里的文字需要先 OCR；目前不会自动识别这些文字。
- 复杂公式、特殊符号、跨栏和密集表格可能需要人工检查。原 PDF 始终保存，便于对照。
- 翻译后 PDF 是可选中文字的 PDF；前端的高亮与浮层使用保存的句段坐标和翻译结果。

DeepSeek 接口使用官方的 [Chat Completions API](https://api-docs.deepseek.com/api/create-chat-completion/) 和 [JSON Output](https://api-docs.deepseek.com/guides/json_mode/)；默认模型为 `deepseek-flash`，可用 `DEEPSEEK_MODEL` 修改。
