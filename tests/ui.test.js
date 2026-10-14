import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToString } from 'react-dom/server';
import { MantineProvider } from '@mantine/core';
import { createServer } from 'vite';

test('reader and task sidebar render the saved PDF record without changing its format', async () => {
  const vite = await createServer({ server: { middlewareMode: true }, optimizeDeps: { noDiscovery: true, include: [] } });
  try {
    const [{ default: Reader }, { default: TaskSidebar }, { default: LatexText }, { default: PdfPage }] = await Promise.all([
      vite.ssrLoadModule('/src/reader/Reader.jsx'),
      vite.ssrLoadModule('/src/components/TaskSidebar.jsx'),
      vite.ssrLoadModule('/src/reader/LatexText.jsx'),
      vite.ssrLoadModule('/src/reader/PdfPage.jsx'),
    ]);
    const document = {
      id: 'paper-1', filename: 'paper.pdf', status: 'done', progress: 100,
      tokens: { prompt: 12000, completion: 8000, total: 20000 },
      pages: [{ number: 1, width: 612, height: 792, lines: [] }],
      original: new Blob(), translated: new Blob(),
    };
    const wrap = node => renderToString(React.createElement(MantineProvider, null, node));
    const reader = wrap(React.createElement(Reader, {
      document, sidebarCollapsed: false, onToggleSidebar() {}, onOpenTasks() {}, overlayOpen: false,
    }));
    assert.equal((reader.match(/class="pdf-page"/g) || []).length, 2);
    assert.match(reader, /缩小/);
    assert.match(reader, /放大/);
    assert.match(reader, /将右侧对齐到左侧/);
    assert.match(reader, /纯视觉识别/);
    assert.match(reader.replaceAll('<!-- -->', ''), /左 1 .*右 1/);
    const visualReader = wrap(React.createElement(Reader, {
      document: { ...document, pages: null, translated: null, visualPages: [{ number: 1, paragraphs: [] }], visualStatus: 'done' },
      mode: 'visual', settings: { key: 'test-key' },
      sidebarCollapsed: false, onToggleSidebar() {}, onOpenTasks() {}, onModeChange() {},
    }));
    assert.match(visualReader, /逐段对照/);
    assert.match(visualReader, /PDF 原件/);
    assert.match(visualReader, /重新识别当前页/);
    assert.match(visualReader.replaceAll('<!-- -->', ''), /左 1 .*右 1/);
    const androidReader = wrap(React.createElement(Reader, {
      document: { ...document, pages: null, translated: null, visualPages: [{ number: 1, paragraphs: [] }], visualStatus: 'done' },
      mode: 'standard', translatedOnly: true, settings: { key: 'test-key' }, onOpenTasks() {},
    }));
    assert.match(androidReader, /translated-only/);
    assert.match(androidReader, /打开任务列表/);
    assert.doesNotMatch(androidReader, /PDF 原件|reader-mode-switch|mobile-view-switch|class="pdf-pane/);
    const screenshotOnlyPage = wrap(React.createElement(PdfPage, {
      page: { number: 1, width: 612, height: 792 }, pdf: null, version: 'original', scale: 1,
      visible: true, onSentenceOpen() {}, onSentenceHover() {}, mobile: false,
    }));
    assert.match(screenshotOnlyPage, /第 1 页原文/);
    const latex = wrap(React.createElement(LatexText, { text: 'Energy $E=mc^2$ and $$x^2+y^2$$' }));
    assert.match(latex, /class="katex"/);
    assert.match(latex, /katex-display/);
    assert.match(latex, /data-latex="E=mc\^2"/);
    assert.match(latex, /data-latex="x\^2\+y\^2"/);
    assert.equal((latex.match(/aria-label="查看 LaTeX 源码"/g) || []).length, 2);
    const environmentFormula = wrap(React.createElement(LatexText, { text: '\\begin{align}x&=y\\end{align}' }));
    assert.ok(environmentFormula.includes('data-latex="\\begin{align}x&amp;=y\\end{align}"'));
    const emphasis = wrap(React.createElement(LatexText, { text: '**Theorem 1 Restated.** *Assume $\\pi_{ref}(y\\mid x)>0$\nfor all pairs.*' }));
    assert.match(emphasis, /<strong>/);
    assert.match(emphasis, /<em>/);
    assert.match(emphasis, /class="katex"/);
    assert.doesNotMatch(emphasis, /\*\*Theorem/);
    const latexEmphasis = wrap(React.createElement(LatexText, {
      text: 'The algorithm \\textit{Direct Preference Optimization} (DPO). 算法称为\\textit{直接偏好优化}。',
    }));
    assert.match(latexEmphasis, /<em><span>Direct Preference Optimization<\/span><\/em>/);
    assert.match(latexEmphasis, /<em><span>直接偏好优化<\/span><\/em>/);
    assert.doesNotMatch(latexEmphasis, /\\textit/);
    const nestedEmphasis = wrap(React.createElement(LatexText, {
      text: '\\textbf{A \\textit{nested} term with $x^2$} and \\emph{emphasis}',
    }));
    assert.match(nestedEmphasis, /<strong>.*<em><span>nested<\/span><\/em>.*class="katex".*<\/strong>/);
    assert.match(nestedEmphasis, /<em><span>emphasis<\/span><\/em>/);
    const numberedFormula = 'f(r; \\pi_{\\text{ref}}, \\beta)(x, y) = r(x, y) - \\beta \\log \\sum_y \\pi_{\\text{ref}}(y \\mid x) \\exp \\left( \\frac{1}{\\beta} r(x, y) \\right) \\tag{8}';
    const bareNumbered = wrap(React.createElement(LatexText, { text: numberedFormula }));
    assert.match(bareNumbered, /class="katex-display"/);
    assert.ok(bareNumbered.includes('data-latex="' + numberedFormula + '"'));
    assert.doesNotMatch(bareNumbered, /class="katex-error"/);
    const detachedNumber = wrap(React.createElement(LatexText, { text: '$$f(x)=x^2$$ \\tag{9}' }));
    assert.match(detachedNumber, /class="katex-display"/);
    assert.doesNotMatch(detachedNumber, /<span> \\tag\{9\}<\/span>/);
    const inlineTagged = wrap(React.createElement(LatexText, { text: '$f(x)=x^2 \\tag{9}$' }));
    assert.match(inlineTagged, /class="katex-display"/);
    assert.doesNotMatch(inlineTagged, /class="katex-error"/);
    const mixedTagged = wrap(React.createElement(LatexText, { text: 'f($x$)=x^2 \\tag{9}' }));
    assert.match(mixedTagged, /class="katex-display"/);
    const bareEquation = wrap(React.createElement(LatexText, { text: 'x^2 + y^2 = z^2', standaloneEquation: true }));
    assert.match(bareEquation, /class="katex-display"/);
    assert.match(bareEquation, /data-latex="x\^2 \+ y\^2 = z\^2"/);
    const sidebar = wrap(React.createElement(TaskSidebar, {
      documents: [document], selected: document, folderId: 'default', onSelect() {}, onNew() {},
      onSettings() {}, onDownload() {}, onRetranslate() {},
    }));
    const rootSidebar = wrap(React.createElement(TaskSidebar, { documents: [document] }));
    assert.match(rootSidebar, /我的目录/);
    assert.match(rootSidebar, /default/);
    assert.doesNotMatch(rootSidebar, /class="task-item/);
    assert.match(sidebar, /返回目录列表/);
    assert.match(sidebar, /查看 paper.pdf 详情/);
    assert.match(sidebar, /调整侧边栏宽度/);
    assert.doesNotMatch(sidebar, /PDF 生成器|创建工具/);
    assert.match(sidebar, /下载译文 PDF/);
    assert.match(sidebar, /按句重译/);
    const sidebarText = sidebar.replaceAll('<!-- -->', '');
    assert.match(sidebarText, /100%<\/small><small>输入 12k 输出 8k/);
    assert.equal((sidebarText.match(/输入 /g) || []).length, 1);
  } finally { await vite.close(); }
});
