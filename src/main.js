import './style.css';
import { getDocument, listDocuments, putDocument } from './storage.js';
import { openPdf, renderPage } from './pdf.js';
import { MAX_PENDING, retryDocument, runQueue, setChangeListener } from './translator.js';

const app = document.querySelector('#app');
const SETTINGS_KEY = 'paperlens-settings-v1';
const settings = { endpoint: 'https://api.deepseek.com/chat/completions', model: 'deepseek-chat', key: '', ...JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}') };
const state = { documents: [], current: null, scale: 1, popup: null, libraryOpen: false, mobileView: 'original' };
let pdfs = {}, observer, generation = 0;
const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
const phone = () => matchMedia('(max-width: 760px)').matches;
const icon = (name, size = 18) => {
  const paths = { book: '<path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 0 4 4.5v15Z"/>', plus: '<path d="M12 5v14M5 12h14"/>', file: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z"/><path d="M14 2v6h6M8 13h8M8 17h8"/>', settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a2 2 0 0 0 .4 2l-2.1 2.1a2 2 0 0 0-2-.4l-1 1.6h-3.4l-1-1.6a2 2 0 0 0-2 .4L6.2 17a2 2 0 0 0 .4-2L5 14v-4l1.6-1a2 2 0 0 0-.4-2l2.1-2.1a2 2 0 0 0 2 .4l1-1.6h3.4l1 1.6a2 2 0 0 0 2-.4L19.8 7a2 2 0 0 0-.4 2l1.6 1v4Z"/>', download: '<path d="M12 3v12m0 0 4-4m-4 4-4-4M4 17v3a1 1 0 0 0 1 1h16a1 1 0 0 0 1-1v-3"/>', left: '<path d="m15 18-6-6 6-6"/>', right: '<path d="m9 18 6-6-6-6"/>', close: '<path d="M18 6 6 18M6 6l12 12"/>', zoomIn: '<circle cx="11" cy="11" r="8"/><path d="M11 8v6M8 11h6m13 10-4.4-4.4"/>', zoomOut: '<circle cx="11" cy="11" r="8"/><path d="M8 11h6m13 10-4.4-4.4"/>' };
  return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name]}</svg>`;
};
const label = doc => doc.filename.replace(/\.pdf$/i, '');
const status = doc => ({ queued: '排队中', extracting: '解析中', translating: '翻译中', typesetting: '排版中', done: '已完成', error: '失败' })[doc.status] || doc.status;
const tokens = doc => `Token ${Number(doc.tokens?.total || 0).toLocaleString()}（输入 ${Number(doc.tokens?.prompt || 0).toLocaleString()} · 输出 ${Number(doc.tokens?.completion || 0).toLocaleString()}）`;
function toast(message) { const node = document.createElement('div'); node.className = 'toast error'; node.textContent = message; document.body.append(node); setTimeout(() => node.remove(), 5000); }

function libraryItems() {
  return state.documents.map(doc => `<button class="history-item ${state.current?.id === doc.id ? 'selected' : ''}" data-open="${doc.id}"><span class="history-icon">${icon('file')}</span><span class="history-copy"><strong title="${esc(doc.filename)}">${esc(label(doc))}</strong><small>${status(doc)} · ${doc.progress}% · ${Number(doc.tokens?.total || 0).toLocaleString()} token</small>${!['done', 'error'].includes(doc.status) ? `<span class="history-progress"><i style="width:${doc.progress}%"></i></span>` : ''}</span>${doc.status === 'done' ? '<span class="history-dot"></span>' : ''}</button>`).join('') || '<p class="empty-history">论文和翻译记录只保存在本机。</p>';
}
function welcome() {
  return `<section class="welcome"><div class="welcome-deco"><span class="deco-page back"></span><span class="deco-page front"><i></i><i></i><i></i><i></i><i></i></span><span class="deco-spark">✦</span></div><div class="eyebrow">READ WITHOUT BORDERS</div><h1>每一篇好论文，<br/><em>都值得被读懂。</em></h1><p>提供自己的翻译 API，在本机完成处理并保存译文。</p><button class="primary-button" id="welcome-upload">${icon('plus')} 上传论文 PDF</button><div class="welcome-hint">支持可提取文字的 PDF · 最高 80 MB</div><div class="welcome-features"><div><span>01</span><strong>原貌呈现</strong><small>图、表、公式与参考文献保持原样</small></div><div><span>02</span><strong>清晰对照</strong><small>双侧整篇滚动，按屏幕分辨率渲染</small></div><div><span>03</span><strong>本地保存</strong><small>论文、译文和进度保存在当前设备</small></div></div></section>`;
}
function progress(doc) {
  return `<section class="progress-screen"><div class="progress-card"><div class="progress-icon">${icon('file', 30)}</div><div class="eyebrow">${doc.status === 'error' ? 'TRANSLATION STOPPED' : 'WORK IN PROGRESS'}</div><h2>${doc.status === 'error' ? '处理遇到了问题' : '正在处理这篇论文'}</h2><p>${esc(doc.filename)}</p>${doc.status === 'error' ? `<div class="error-box">${esc(doc.error)}</div><button class="primary-button" id="retry-document">继续翻译</button>` : `<div class="progress-track"><span style="width:${doc.progress}%"></span></div><div class="progress-bottom"><span>${status(doc)}</span><strong>${doc.progress}%</strong></div>`}<small>${tokens(doc)}</small></div></section>`;
}
function zone(line, page) {
  const [x0, y0, x1, y1] = line.rect;
  return `<div class="sentence-zone" data-line="${line.id}" data-page="${page.number}" style="left:${100 * x0 / page.width}%;top:${100 * y0 / page.height}%;width:${100 * (x1 - x0) / page.width}%;height:${100 * (y1 - y0) / page.height}%" title="${esc(line.translation)}"></div>`;
}
function column(version, pages) {
  return `<div class="paper-column ${version}"><div class="paper-column-heading"><span class="language-pill ${version === 'translated' ? 'translated-pill' : ''}">${version === 'original' ? '原文' : '译文'}</span><span>${version === 'original' ? '原始论文' : '简体中文'}</span></div><div class="paper-scroll" data-version="${version}">${pages.map(page => `<div class="paper" data-page="${page.number}" style="width:${state.scale * 100}%;aspect-ratio:${page.width}/${page.height}"><canvas aria-label="第 ${page.number} 页${version === 'original' ? '原文' : '译文'}"></canvas><div class="overlay">${page.lines.filter(line => line.translate && line.translation).map(line => zone(line, page)).join('')}</div></div>`).join('')}</div></div>`;
}
function workspace(doc) {
  return `<section class="workspace"><div class="doc-toolbar"><div class="doc-heading"><span class="doc-kicker">正在阅读 · ${doc.pages.length} 页 · ${tokens(doc)}</span><h1 title="${esc(doc.filename)}">${esc(label(doc))}</h1></div><div class="reader-controls"><button id="zoom-out" aria-label="缩小">${icon('zoomOut')}</button><span class="zoom-value">${Math.round(state.scale * 100)}%</span><button id="zoom-in" aria-label="放大">${icon('zoomIn')}</button></div></div>${doc.warnings?.length ? `<div class="warning">有 ${doc.warnings.length} 行译文超出原位置，请双击查看全文。</div>` : ''}<div class="reading-tip">双击文字查看完整译文 · 光标在两侧之外时一起滚动</div><div class="mobile-view-toggle"><button data-mobile-view="original" class="${state.mobileView === 'original' ? 'selected' : ''}">原文</button><button data-mobile-view="translated" class="${state.mobileView === 'translated' ? 'selected' : ''}">译文</button></div><div class="spread mobile-${state.mobileView}">${column('original', doc.pages)}<div class="sync-controls"><button id="sync-right" aria-label="将右侧对齐到左侧" title="将右侧对齐到左侧">${icon('right', 20)}</button><button id="sync-left" aria-label="将左侧对齐到右侧" title="将左侧对齐到右侧">${icon('left', 20)}</button></div>${column('translated', doc.pages)}</div></section>`;
}
function popup(line) { return `<div class="popup-scrim" id="popup-scrim"></div><section class="translation-popup" role="dialog" aria-label="译文"><div class="popup-handle"></div><div class="popup-top"><span class="language-pill translated-pill">译文</span><button id="close-popup" aria-label="关闭">${icon('close')}</button></div><p class="popup-translation">${esc(line.translation)}</p><details><summary>查看原文</summary><p>${esc(line.source)}</p></details></section>`; }

function render() {
  const scrolls = Object.fromEntries([...document.querySelectorAll('.paper-scroll')].map(node => [node.dataset.version, [node.scrollLeft, node.scrollTop]]));
  observer?.disconnect(); generation++;
  const doc = state.current;
  app.innerHTML = `<aside class="sidebar"><div class="brand"><span class="brand-mark">${icon('book', 21)}</span><span>PaperLens<small>论文翻译工作台</small></span></div><button class="new-button" id="new-document">${icon('plus')} 新建翻译</button><div class="sidebar-heading">我的文献 <span>${state.documents.length}</span></div><div class="history">${libraryItems()}</div><div class="sidebar-foot"><button id="settings-button">${icon('settings')} API 设置</button><span>所有文件和记录只保存在本机</span></div></aside><main class="main"><header class="topbar"><div class="mobile-brand">${icon('book')} PaperLens</div><div class="breadcrumb">工作台 <span>/</span> ${doc ? esc(label(doc)) : '欢迎使用'}</div><div class="top-actions">${doc?.status === 'done' ? `<button class="top-download" id="download-pdf">${icon('download')}<span>下载译文 PDF</span></button>` : ''}<button class="mobile-settings" id="mobile-library" aria-label="我的文献">${icon('file')}</button><button class="mobile-settings" id="mobile-settings" aria-label="API 设置">${icon('settings')}</button></div></header>${!doc ? welcome() : doc.status === 'done' && doc.pages ? workspace(doc) : progress(doc)}</main><input id="file-input" type="file" accept="application/pdf,.pdf" hidden />${state.libraryOpen ? `<div class="library-scrim" id="library-scrim"></div><section class="mobile-library"><div class="mobile-library-head"><h2>我的文献</h2><button id="library-close">${icon('close')}</button></div><button class="new-button" id="library-upload">${icon('plus')} 新建翻译</button><div class="mobile-library-items">${libraryItems()}</div></section>` : ''}${state.popup ? popup(state.popup) : ''}`;
  bind();
  for (const node of document.querySelectorAll('.paper-scroll')) if (scrolls[node.dataset.version]) [node.scrollLeft, node.scrollTop] = scrolls[node.dataset.version];
  if (doc?.status === 'done') setupPages();
}
async function setupPages() {
  const id = state.current.id, currentGeneration = generation;
  for (const version of ['original', 'translated']) if (!pdfs[version]) {
    const blob = state.current[version]; if (!blob) return;
    try { pdfs[version] = await openPdf(new Uint8Array(await blob.arrayBuffer())); }
    catch (error) { toast(`PDF 无法打开：${error.message}`); return; }
  }
  if (state.current?.id !== id || generation !== currentGeneration) return;
  observer = new IntersectionObserver(entries => { for (const entry of entries) if (entry.isIntersecting) draw(entry.target, currentGeneration); }, { rootMargin: '500px' });
  document.querySelectorAll('.paper').forEach(node => observer.observe(node));
}
async function draw(node, currentGeneration) {
  const canvas = node.querySelector('canvas'), width = node.clientWidth;
  if (canvas.dataset.rendering === 'true' || Number(canvas.dataset.width) === width) return;
  canvas.dataset.rendering = 'true';
  try { await renderPage(pdfs[node.closest('.paper-scroll').dataset.version], Number(node.dataset.page), canvas, width); if (currentGeneration === generation) canvas.dataset.width = String(width); }
  catch (error) { if (currentGeneration === generation) toast(error.message); }
  finally { canvas.dataset.rendering = 'false'; }
}
function bind() {
  const choose = () => document.querySelector('#file-input').click();
  for (const id of ['new-document', 'welcome-upload', 'library-upload']) document.getElementById(id)?.addEventListener('click', choose);
  document.getElementById('file-input')?.addEventListener('change', event => { if (event.target.files[0]) upload(event.target.files[0]); });
  document.querySelectorAll('[data-open]').forEach(node => node.addEventListener('click', () => openDocument(node.dataset.open)));
  for (const id of ['settings-button', 'mobile-settings']) document.getElementById(id)?.addEventListener('click', showSettings);
  document.getElementById('mobile-library')?.addEventListener('click', () => { state.libraryOpen = true; render(); });
  for (const id of ['library-close', 'library-scrim']) document.getElementById(id)?.addEventListener('click', () => { state.libraryOpen = false; render(); });
  document.getElementById('retry-document')?.addEventListener('click', () => retryDocument(state.current.id, settings));
  document.getElementById('download-pdf')?.addEventListener('click', download);
  document.getElementById('zoom-in')?.addEventListener('click', () => zoom(.25));
  document.getElementById('zoom-out')?.addEventListener('click', () => zoom(-.25));
  document.getElementById('sync-right')?.addEventListener('click', () => sync('original', 'translated'));
  document.getElementById('sync-left')?.addEventListener('click', () => sync('translated', 'original'));
  document.querySelectorAll('[data-mobile-view]').forEach(node => node.addEventListener('click', () => { state.mobileView = node.dataset.mobileView; render(); }));
  document.querySelectorAll('.sentence-zone').forEach(node => {
    node.addEventListener('pointerenter', () => highlight(node.dataset.line)); node.addEventListener('pointerleave', () => highlight(null));
    const open = () => { state.popup = state.current.pages[Number(node.dataset.page) - 1].lines.find(line => line.id === node.dataset.line); render(); };
    node.addEventListener('dblclick', open); if (phone()) node.addEventListener('click', open);
  });
  document.getElementById('close-popup')?.addEventListener('click', closePopup); document.getElementById('popup-scrim')?.addEventListener('click', closePopup);
}
function closePopup() { state.popup = null; render(); }
function highlight(id) { document.querySelectorAll('.sentence-zone').forEach(node => node.classList.toggle('active', node.dataset.line === id)); }
function sync(from, to) { const source = document.querySelector(`.paper-scroll[data-version="${from}"]`), target = document.querySelector(`.paper-scroll[data-version="${to}"]`); if (source && target) target.scrollTop = source.scrollTop / Math.max(1, source.scrollHeight - source.clientHeight) * Math.max(0, target.scrollHeight - target.clientHeight); }
function zoom(delta) { state.scale = Math.max(.75, Math.min(2.5, state.scale + delta)); render(); }
async function refresh() { state.documents = await listDocuments(); if (state.current) state.current = state.documents.find(item => item.id === state.current.id) || null; render(); }
async function openDocument(id) { if (state.current?.id !== id) { for (const pdf of Object.values(pdfs)) await pdf.loadingTask.destroy(); pdfs = {}; } state.current = await getDocument(id); state.popup = null; state.libraryOpen = false; render(); }
async function upload(file) {
  if (!/\.pdf$/i.test(file.name) || file.type && file.type !== 'application/pdf') return toast('请选择 PDF 文件');
  if (file.size > 80 * 1024 * 1024) return toast('PDF 不能超过 80 MB');
  if (state.documents.filter(item => !['done', 'error'].includes(item.status)).length >= MAX_PENDING) return toast(`最多等待 ${MAX_PENDING} 篇论文，请稍后提交。`);
  const record = { id: crypto.randomUUID(), filename: file.name, createdAt: Date.now(), status: 'queued', progress: 0, tokens: { prompt: 0, completion: 0, total: 0 }, original: file, translated: null, pages: null, warnings: [], error: '' };
  try { await putDocument(record); await refresh(); await openDocument(record.id); if (!settings.key) showSettings(); else runQueue(settings); }
  catch (error) { toast(`本地保存失败：${error.message}`); }
}
function download() { const blob = state.current?.translated; if (!blob) return; const url = URL.createObjectURL(blob), link = document.createElement('a'); link.href = url; link.download = `${label(state.current)}-译文.pdf`; link.click(); setTimeout(() => URL.revokeObjectURL(url), 30000); }
function showSettings() {
  const dialog = document.createElement('dialog'); dialog.className = 'settings-dialog';
  dialog.innerHTML = `<form method="dialog"><button class="dialog-close" value="cancel" aria-label="关闭">${icon('close')}</button><div class="eyebrow">LOCAL API</div><h2>翻译 API 设置</h2><p>输入您自己的 OpenAI 兼容 API。请求从当前设备直连，密钥只保存在本机浏览器或应用存储中。</p><label>Chat Completions 地址<input id="api-endpoint" type="url" required value="${esc(settings.endpoint)}" /></label><label>模型<input id="api-model" required value="${esc(settings.model)}" /></label><label>API Key<input id="api-key" type="password" autocomplete="off" value="${esc(settings.key)}" /></label><small>API 服务需允许浏览器跨域请求。清除本站数据会同时删除密钥、论文与翻译记录。</small><button class="primary-button" value="save">保存</button></form>`;
  document.body.append(dialog); dialog.showModal();
  dialog.addEventListener('close', () => { if (dialog.returnValue === 'save') { settings.endpoint = dialog.querySelector('#api-endpoint').value.trim(); settings.model = dialog.querySelector('#api-model').value.trim(); settings.key = dialog.querySelector('#api-key').value.trim(); localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings)); runQueue(settings); } dialog.remove(); });
}
setChangeListener(record => { const index = state.documents.findIndex(item => item.id === record.id); if (index >= 0) state.documents[index] = record; else state.documents.unshift(record); if (state.current?.id === record.id) state.current = record; render(); });
addEventListener('resize', () => { if (state.current?.status === 'done') render(); });
addEventListener('wheel', event => {
  if (state.current?.status !== 'done' || event.target.closest('.paper-scroll, dialog, .translation-popup')) return;
  event.preventDefault();
  document.querySelectorAll('.paper-scroll').forEach(node => { node.scrollTop += event.deltaY; node.scrollLeft += event.deltaX; });
}, { passive: false });
await refresh(); runQueue(settings);
