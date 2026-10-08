import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToString } from 'react-dom/server';
import { MantineProvider } from '@mantine/core';
import { createServer } from 'vite';

test('reader and task sidebar render the saved PDF record without changing its format', async () => {
  const vite = await createServer({ server: { middlewareMode: true }, optimizeDeps: { noDiscovery: true, include: [] } });
  try {
    const [{ default: Reader }, { default: TaskSidebar }] = await Promise.all([
      vite.ssrLoadModule('/src/reader/Reader.jsx'),
      vite.ssrLoadModule('/src/components/TaskSidebar.jsx'),
    ]);
    const document = {
      id: 'paper-1', filename: 'paper.pdf', status: 'done', progress: 100,
      tokens: { prompt: 12, completion: 8, total: 20 },
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
    const sidebar = wrap(React.createElement(TaskSidebar, {
      documents: [document], selected: document, onSelect() {}, onNew() {},
      onSettings() {}, onDownload() {}, onRetranslate() {},
    }));
    assert.match(sidebar, /下载译文 PDF/);
    assert.match(sidebar, /按句重译/);
    assert.match(sidebar.replaceAll('<!-- -->', ''), /输入 12/);
  } finally { await vite.close(); }
});
