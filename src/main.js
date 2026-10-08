import './style.css';

const app = document.querySelector('#app');
const state = {
  documents: [], document: null, metadata: null, page: 0, scale: 1,
  activeSentence: null, activeBlock: null, popupBlock: null, libraryOpen: false,
  apiBase: localStorage.getItem('paperlens-api-base') || '',
  poll: null, busy: false,
};

const isNative = location.protocol === 'capacitor:' || location.protocol === 'https:' && location.hostname === 'localhost';
const isPhone = () => window.matchMedia('(max-width: 760px)').matches || isNative;
const escapeHtml = (value = '') => String(value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const base = () => state.apiBase.replace(/\/$/, '');
const apiUrl = path => `${base()}${path}`;

async function api(path, options = {}) {
  let response;
  try { response = await fetch(apiUrl(path), options); }
  catch { throw new Error('无法连接后端，请检查服务器地址与网络连接'); }
  if (!response.ok) {
    let message = `请求失败 (${response.status})`;
    try { const body = await response.json(); message = body.detail || message; } catch {}
    throw new Error(message);
  }
  return response.json();
}

function toast(message, type = 'error') {
  const element = document.createElement('div');
  element.className = `toast ${type}`;
  element.textContent = message;
  document.body.append(element);
  setTimeout(() => element.remove(), 4300);
}

function icon(name, size = 20) {
  const paths = {
    book: '<path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2Z"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    upload: '<path d="M12 16V3m0 0 5 5m-5-5L7 8"/><path d="M4 16v4a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-4"/>',
    chevronLeft: '<path d="m15 18-6-6 6-6"/>',
    chevronRight: '<path d="m9 18 6-6-6-6"/>',
    download: '<path d="M12 3v12m0 0 4-4m-4 4-4-4M4 17v3a1 1 0 0 0 1 1h16a1 1 0 0 0 1-1v-3"/>',
    settings: '<path d="M12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Z"/><path d="M19.4 15a1.7 1.7 0 0 0 .34 1.88l.06.06-1.7 2.94-.08-.02a1.7 1.7 0 0 0-1.8.64l-.04.07h-3.4l-.02-.08a1.7 1.7 0 0 0-1.26-1.4h-.08a1.7 1.7 0 0 0-1.54 1.48H6.47l-.04-.07a1.7 1.7 0 0 0-1.8-.64l-.08.02-1.7-2.94.06-.06A1.7 1.7 0 0 0 3.25 15l-.08-.03v-3.4l.08-.02a1.7 1.7 0 0 0 1.4-1.26l.01-.08a1.7 1.7 0 0 0-1.48-1.54l1.7-2.94.08.02a1.7 1.7 0 0 0 1.8-.64l.04-.07h3.4l.02.08a1.7 1.7 0 0 0 1.26 1.4h.08a1.7 1.7 0 0 0 1.54-1.48h3.4l.04.07a1.7 1.7 0 0 0 1.8.64l.08-.02 1.7 2.94-.06.06a1.7 1.7 0 0 0-.34 1.88l.08.03v3.4Z" transform="translate(-.6 -.8) scale(.96)"/>',
    close: '<path d="M18 6 6 18M6 6l12 12"/>',
    file: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z"/><path d="M14 2v6h6M8 13h8M8 17h8"/>',
    sparkle: '<path d="m12 3 1.8 6.2L20 11l-6.2 1.8L12 19l-1.8-6.2L4 11l6.2-1.8L12 3ZM19 18l.5 1.5L21 20l-1.5.5L19 22l-.5-1.5L17 20l1.5-.5L19 18Z"/>',
    zoomIn: '<path d="M11 8v6M8 11h6"/><circle cx="11" cy="11" r="8"/><path d="m21 21-4.4-4.4"/>',
    zoomOut: '<path d="M8 11h6"/><circle cx="11" cy="11" r="8"/><path d="m21 21-4.4-4.4"/>',
  };
  return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name]}</svg>`;
}

function documentLabel(item) { return item.filename.replace(/\.pdf$/i, ''); }
function statusLabel(item) { return ({done:'已完成',queued:'等待中',translating:'翻译中',typesetting:'排版中',error:'失败'})[item.status] || item.status; }

function render() {
  const doc = state.document;
  const paperScroll = [...document.querySelectorAll('.paper-scroll')].map(element => [element.scrollLeft, element.scrollTop]);
  app.innerHTML = `
    <aside class="sidebar">
      <div class="brand"><span class="brand-mark">${icon('book', 21)}</span><span>PaperLens<small>论文翻译工作台</small></span></div>
      <button class="new-button" id="new-document">${icon('plus',18)} 新建翻译</button>
      <div class="sidebar-heading">我的文献 <span>${state.documents.length}</span></div>
      <div class="history">${state.documents.map(item => `<button class="history-item ${doc?.id === item.id ? 'selected' : ''}" data-open="${item.id}"><span class="history-icon">${icon('file', 19)}</span><span class="history-copy"><strong title="${escapeHtml(item.filename)}">${escapeHtml(documentLabel(item))}</strong><small>${new Date(item.created_at * 1000).toLocaleDateString('zh-CN')} · ${statusLabel(item)}</small></span>${item.status === 'done' ? '<span class="history-dot"></span>' : ''}</button>`).join('') || '<p class="empty-history">翻译过的论文会保存在这里。</p>'}</div>
      <div class="sidebar-foot"><button id="settings-button">${icon('settings',18)} 服务器设置</button><span>把语言的距离缩短一点</span></div>
    </aside>
    <main class="main">
      <header class="topbar"><div class="mobile-brand">${icon('book',19)} PaperLens</div><div class="breadcrumb">工作台 <span>/</span> ${doc ? escapeHtml(documentLabel(doc)) : '欢迎使用'}</div><div class="top-actions">${doc?.status === 'done' ? `<button class="top-download" id="download-pdf">${icon('download',17)}<span>下载译文 PDF</span></button>` : ''}<button class="mobile-settings" id="mobile-library" aria-label="我的文献">${icon('file',20)}</button><button class="mobile-settings" id="mobile-settings" aria-label="服务器设置">${icon('settings',20)}</button></div></header>
      ${!doc ? welcome() : doc.status === 'done' && state.metadata ? workspace() : progress(doc)}
    </main>
    <input id="file-input" type="file" accept="application/pdf,.pdf" hidden />
    ${state.libraryOpen ? mobileLibrary() : ''}
    ${state.popupBlock ? popup(state.popupBlock) : ''}
  `;
  bind();
  document.querySelectorAll('.paper-scroll').forEach((element, index) => {
    if (paperScroll[index]) [element.scrollLeft, element.scrollTop] = paperScroll[index];
  });
}

function mobileLibrary() {
  return `<div class="library-scrim" id="library-scrim"></div><section class="mobile-library"><div class="mobile-library-head"><h2>我的文献</h2><button id="library-close" aria-label="关闭">${icon('close',20)}</button></div><button class="new-button" id="library-upload">${icon('plus',18)} 新建翻译</button><div class="mobile-library-items">${state.documents.map(item => `<button class="history-item ${state.document?.id === item.id ? 'selected' : ''}" data-open="${item.id}"><span class="history-icon">${icon('file',19)}</span><span class="history-copy"><strong>${escapeHtml(documentLabel(item))}</strong><small>${new Date(item.created_at * 1000).toLocaleDateString('zh-CN')} · ${statusLabel(item)}</small></span></button>`).join('') || '<p class="empty-history">还没有翻译记录。</p>'}</div></section>`;
}

function welcome() {
  return `<section class="welcome"><div class="welcome-deco"><span class="deco-page back"></span><span class="deco-page front"><i></i><i></i><i></i><i></i><i></i></span><span class="deco-spark">✦</span></div><div class="eyebrow">READ WITHOUT BORDERS</div><h1>每一篇好论文，<br/><em>都值得被读懂。</em></h1><p>上传 PDF，保留原有版式，获得精准的双语对照阅读体验。</p><button class="primary-button" id="welcome-upload">${icon('upload',19)} 上传论文 PDF</button><div class="welcome-hint">支持可提取文字的 PDF · 最高 80 MB</div><div class="welcome-features"><div><span>01</span><strong>原貌呈现</strong><small>图片、表格与版面保持原位</small></div><div><span>02</span><strong>双语对照</strong><small>聚焦句子，双侧同步高亮</small></div><div><span>03</span><strong>随时续读</strong><small>译文与阅读记录自动保存</small></div></div></section>`;
}

function progress(doc) {
  return `<section class="progress-screen"><div class="progress-card"><div class="progress-icon">${icon(doc.status === 'error' ? 'close' : 'sparkle',30)}</div><div class="eyebrow">${doc.status === 'error' ? 'TRANSLATION STOPPED' : 'WORK IN PROGRESS'}</div><h2>${doc.status === 'error' ? '处理遇到了问题' : '正在细读这篇论文'}</h2><p>${escapeHtml(doc.filename)}</p>${doc.status === 'error' ? `<div class="error-box">${escapeHtml(doc.error || '未知错误')}</div><button id="retry-document" class="primary-button">继续翻译</button>` : `<div class="progress-track"><span style="width:${doc.progress}%"></span></div><div class="progress-bottom"><span>${statusLabel(doc)}</span><strong>${doc.progress}%</strong></div><small>翻译完成后，原文和译文会自动出现在这里。</small>`}</div></section>`;
}

function workspace() {
  const doc = state.document;
  const pages = state.metadata.pages;
  const page = pages[state.page];
  return `<section class="workspace"><div class="doc-toolbar"><div class="doc-heading"><span class="doc-kicker">正在阅读</span><h1 title="${escapeHtml(doc.filename)}">${escapeHtml(documentLabel(doc))}</h1></div><div class="reader-controls"><div class="page-control"><button id="prev-page" ${state.page === 0 ? 'disabled' : ''} aria-label="上一页">${icon('chevronLeft',18)}</button><span>${state.page + 1} <small>/ ${pages.length}</small></span><button id="next-page" ${state.page === pages.length - 1 ? 'disabled' : ''} aria-label="下一页">${icon('chevronRight',18)}</button></div><span class="toolbar-divider"></span><button class="zoom-button" id="zoom-out" aria-label="缩小">${icon('zoomOut',18)}</button><span class="zoom-value">${Math.round(state.scale * 100)}%</span><button class="zoom-button" id="zoom-in" aria-label="放大">${icon('zoomIn',18)}</button></div></div>${state.metadata.warnings?.length ? `<div class="warning">部分译文超过原文本框，PDF 内可能显示不全；双击对应段落可查看完整译文。共 ${state.metadata.warnings.length} 处。</div>` : ''}<div class="reading-tip">${isPhone() ? '轻点原文段落，查看译文' : '悬停句子同步高亮 · 双击查看完整段落'}</div><div class="spread"><div class="paper-column original"><div class="paper-column-heading"><span class="language-pill">原文</span><span>原始论文</span></div>${paper(page, 'original')}</div><div class="paper-column translated"><div class="paper-column-heading"><span class="language-pill translated-pill">译文</span><span>${escapeHtml(doc.target_language)}</span></div>${paper(page, 'translated')}</div></div><div class="mobile-bottom"><button id="mobile-prev" ${state.page === 0 ? 'disabled' : ''}>${icon('chevronLeft',20)}</button><span>第 ${state.page + 1} / ${pages.length} 页</span><button id="mobile-next" ${state.page === pages.length - 1 ? 'disabled' : ''}>${icon('chevronRight',20)}</button></div></section>`;
}

function paper(page, version) {
  const blocks = page.blocks;
  const overlay = isPhone() ? blocks.map(block => rectOverlay(block.rect, 'block-zone', block.id, page)) : blocks.flatMap(block => block.sentences.flatMap(sentence => (version === 'original' ? sentence.source_rects : sentence.translation_rects).map(rect => rectOverlay(rect, 'sentence-zone', sentence.id, page))));
  return `<div class="paper-scroll"><div class="paper" style="width:${state.scale * 100}%;max-width:none;aspect-ratio:${page.width}/${page.height}"><img src="${apiUrl(`/api/documents/${state.document.id}/pages/${state.page}/${version}.png?scale=2`)}" alt="第 ${state.page + 1} 页${version === 'original' ? '原文' : '译文'}" draggable="false"/><div class="overlay">${overlay.join('')}</div></div></div>`;
}

function rectOverlay(rect, className, id, page) {
  if (!rect) return '';
  const [x0,y0,x1,y1] = rect;
  return `<div class="${className}" data-id="${id}" style="left:${x0 / page.width * 100}%;top:${y0 / page.height * 100}%;width:${(x1-x0) / page.width * 100}%;height:${(y1-y0) / page.height * 100}%"></div>`;
}

function popup(block) {
  return `<div class="popup-scrim" id="popup-scrim"></div><section class="translation-popup" role="dialog" aria-label="段落译文"><div class="popup-handle"></div><div class="popup-top"><span class="language-pill translated-pill">段落译文</span><button id="close-popup" aria-label="关闭">${icon('close',20)}</button></div><p class="popup-translation">${escapeHtml(block.translation)}</p><details><summary>查看原文</summary><p>${escapeHtml(block.source)}</p></details></section>`;
}

function highlight(id) {
  state.activeSentence = id;
  document.querySelectorAll('.sentence-zone').forEach(element => element.classList.toggle('active', element.dataset.id === id));
}

function bind() {
  document.querySelector('#new-document')?.addEventListener('click', () => document.querySelector('#file-input').click());
  document.querySelector('#welcome-upload')?.addEventListener('click', () => document.querySelector('#file-input').click());
  document.querySelector('#retry-document')?.addEventListener('click', retry);
  document.querySelector('#file-input')?.addEventListener('change', event => { if (event.target.files[0]) upload(event.target.files[0]); });
  document.querySelectorAll('[data-open]').forEach(button => button.addEventListener('click', () => openDocument(button.dataset.open)));
  document.querySelector('#settings-button')?.addEventListener('click', settings);
  document.querySelector('#mobile-settings')?.addEventListener('click', settings);
  document.querySelector('#mobile-library')?.addEventListener('click', () => { state.libraryOpen = true; render(); });
  document.querySelector('#library-close')?.addEventListener('click', () => { state.libraryOpen = false; render(); });
  document.querySelector('#library-scrim')?.addEventListener('click', () => { state.libraryOpen = false; render(); });
  document.querySelector('#library-upload')?.addEventListener('click', () => document.querySelector('#file-input').click());
  document.querySelector('#download-pdf')?.addEventListener('click', download);
  document.querySelector('#prev-page')?.addEventListener('click', () => changePage(-1));
  document.querySelector('#next-page')?.addEventListener('click', () => changePage(1));
  document.querySelector('#mobile-prev')?.addEventListener('click', () => changePage(-1));
  document.querySelector('#mobile-next')?.addEventListener('click', () => changePage(1));
  document.querySelector('#zoom-out')?.addEventListener('click', () => zoom(-0.25));
  document.querySelector('#zoom-in')?.addEventListener('click', () => zoom(0.25));
  document.querySelectorAll('.sentence-zone').forEach(zone => {
    zone.addEventListener('pointerenter', () => highlight(zone.dataset.id));
    zone.addEventListener('pointerleave', () => highlight(null));
    zone.addEventListener('click', () => highlight(zone.dataset.id));
    zone.addEventListener('dblclick', () => {
      const block = state.metadata.pages[state.page].blocks.find(item => item.sentences.some(sentence => sentence.id === zone.dataset.id));
      if (block) { state.popupBlock = block; render(); }
    });
  });
  document.querySelectorAll('.block-zone').forEach(zone => zone.addEventListener('click', () => {
    const scrollPosition = window.scrollY;
    state.popupBlock = state.metadata.pages[state.page].blocks.find(block => block.id === zone.dataset.id);
    render();
    window.scrollTo(0, scrollPosition);
  }));
  document.querySelector('#close-popup')?.addEventListener('click', closePopup);
  document.querySelector('#popup-scrim')?.addEventListener('click', closePopup);
}

function closePopup() { const scrollPosition = window.scrollY; state.popupBlock = null; render(); window.scrollTo(0, scrollPosition); }
function changePage(delta) { state.page = Math.max(0, Math.min(state.metadata.pages.length - 1, state.page + delta)); state.popupBlock = null; render(); window.scrollTo(0, 0); document.querySelectorAll('.paper-scroll').forEach(element => { element.scrollTop = 0; element.scrollLeft = 0; }); }
function zoom(delta) { state.scale = Math.max(0.75, Math.min(2.5, state.scale + delta)); render(); }

async function refreshHistory() {
  try { state.documents = await api('/api/documents'); render(); }
  catch (error) { if (!isNative || state.apiBase) toast(error.message); render(); }
}

async function openDocument(id) {
  try {
    state.libraryOpen = false;
    state.document = await api(`/api/documents/${id}`);
    state.page = 0;
    state.metadata = state.document.status === 'done' ? await api(`/api/documents/${id}/metadata`) : null;
    render();
    if (state.document.status !== 'done' && state.document.status !== 'error') poll(id);
    else clearInterval(state.poll);
  } catch (error) { toast(error.message); }
}

function poll(id) {
  clearInterval(state.poll);
  state.poll = setInterval(async () => {
    try {
      const doc = await api(`/api/documents/${id}`);
      if (state.document?.id !== id) { clearInterval(state.poll); return; }
      state.document = doc;
      if (doc.status === 'done') {
        clearInterval(state.poll);
        state.metadata = await api(`/api/documents/${id}/metadata`);
        state.documents = await api('/api/documents');
      } else if (doc.status === 'error') { clearInterval(state.poll); state.documents = await api('/api/documents'); }
      render();
    } catch (error) { clearInterval(state.poll); toast(error.message); }
  }, 1800);
}

async function upload(file) {
  if (!file.name.toLowerCase().endsWith('.pdf')) return toast('请选择 PDF 文件');
  if (file.size > 80 * 1024 * 1024) return toast('PDF 不能超过 80 MB');
  const form = new FormData();
  form.append('file', file);
  form.append('target_language', '简体中文');
  try {
    const doc = await api('/api/documents', {method:'POST', body:form});
    state.documents = await api('/api/documents');
    state.document = doc; state.metadata = null; state.page = 0; render(); poll(doc.id);
  } catch (error) { toast(error.message); }
}

async function retry() {
  if (!state.document) return;
  try {
    state.document = await api(`/api/documents/${state.document.id}/retry`, {method:'POST'});
    render(); poll(state.document.id);
  } catch (error) { toast(error.message); }
}

async function download() {
  const doc = state.document;
  if (!doc) return;
  try {
    const response = await fetch(apiUrl(`/api/documents/${doc.id}/translated.pdf`));
    if (!response.ok) throw new Error('下载失败');
    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url; link.download = `${documentLabel(doc)}-译文.pdf`; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  } catch (error) { toast(error.message); }
}

function settings() {
  const dialog = document.createElement('dialog');
  dialog.className = 'settings-dialog';
  dialog.innerHTML = `<form method="dialog"><button class="dialog-close" value="cancel" aria-label="关闭">${icon('close',20)}</button><div class="eyebrow">CONNECTION</div><h2>服务器设置</h2><p>手机和电脑需连接到同一台可访问的 PaperLens 后端。网页版通常留空即可。</p><label>服务器地址<input id="base-url" type="url" placeholder="http://192.168.1.20:8000" value="${escapeHtml(state.apiBase)}" /></label><small>只填地址和端口，不要加 /api。API key 保存在服务器环境变量里。</small><button class="primary-button" value="save">保存并连接</button></form>`;
  document.body.append(dialog); dialog.showModal();
  dialog.addEventListener('close', () => {
    if (dialog.returnValue === 'save') {
      state.apiBase = dialog.querySelector('#base-url').value.trim().replace(/\/$/, '');
      localStorage.setItem('paperlens-api-base', state.apiBase);
      state.document = null; state.metadata = null; refreshHistory();
    }
    dialog.remove();
  });
}

window.addEventListener('resize', () => { if (state.document?.status === 'done') render(); });
render();
if (isNative && !state.apiBase) settings();
else refreshHistory();
