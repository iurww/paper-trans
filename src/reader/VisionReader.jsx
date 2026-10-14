import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActionIcon, Alert, Button, Loader, SegmentedControl } from '@mantine/core';
import { useMediaQuery } from '@mantine/hooks';
import { Download, FileJson, FileText, PanelLeftClose, PanelLeftOpen, RotateCcw, ZoomIn, ZoomOut } from 'lucide-react';
import PdfPane from './PdfPane.jsx';
import LatexText from './LatexText.jsx';
import LatexSourcePopup from './LatexSourcePopup.jsx';
import { displayParagraphText } from './visual-format.js';
import { getPdfPageInfo, runVisualTranslation } from '../translation/vision-translator.js';
import { visibleVisualPages } from '../translation/visual-content.js';
import { alignmentInputs, exportAlignment, highlightRanges, separatorAlignment } from '../alignment/sentence-alignment.js';
import { highlightSentence } from './sentence-highlight.js';
import { saveBlob } from '../platform/desktop.js';

const ignoreSentence = () => {};
const readingFontSizes = { original: 15, chinese: 16, title: 22, heading: 18, small: 14 };

function ZoomControls({ label, scale, onChange }) {
  return <div className="vision-zoom-group" role="group" aria-label={`${label}缩放`}>
    <span className="vision-zoom-label">{label} {Math.round(scale * 100)}%</span>
    <ActionIcon variant="subtle" color="teal" aria-label={`${label}缩小`} title={`${label}缩小`} disabled={scale <= .75}
      onClick={() => onChange(value => Math.max(.75, value - .25))}><ZoomOut size={18} /></ActionIcon>
    <ActionIcon variant="subtle" color="teal" aria-label={`${label}放大`} title={`${label}放大`} disabled={scale >= 2.5}
      onClick={() => onChange(value => Math.min(2.5, value + .25))}><ZoomIn size={18} /></ActionIcon>
  </div>;
}

const VisualParagraph = memo(function VisualParagraph({ paragraph, index, alignment, onSentenceHover }) {
  const { original, chinese } = displayParagraphText(paragraph);
  const fallback = alignment?.paragraphs?.find(item => item.paragraph === index)?.granularity === 'paragraph';
  return <article className={`visual-paragraph visual-${paragraph.kind}`} title={fallback ? '整段对照' : undefined}>
    <div className="visual-original"><LatexText text={original} standaloneEquation={paragraph.kind === 'equation'}
      ranges={highlightRanges(alignment, index, 'original')} onSentenceHover={onSentenceHover} /></div>
    {chinese && <div className="visual-chinese"><LatexText text={chinese}
      ranges={highlightRanges(alignment, index, 'chinese')} onSentenceHover={onSentenceHover} /></div>}
  </article>;
});

export default memo(function VisionReader({ document, settings, sidebarCollapsed, onToggleSidebar, onOpenTasks, onModeChange, translatedOnly = false }) {
  const narrow = useMediaQuery('(max-width: 760px)');
  const mobile = translatedOnly || narrow;
  const [pages, setPages] = useState([]);
  const [pageError, setPageError] = useState('');
  const [sidePages, setSidePages] = useState({ original: 1, translated: 1 });
  const [activePage, setActivePage] = useState(1);
  const [originalScale, setOriginalScale] = useState(1);
  const [translatedScale, setTranslatedScale] = useState(1);
  const readingStyle = useMemo(() => {
    const style = {};
    for (const [kind, base] of Object.entries(readingFontSizes)) {
      const size = Math.round(base * translatedScale);
      style[`--reading-${kind}-size`] = `${size}px`;
      style[`--reading-${kind}-line-height`] = `${Math.round(size * 1.75)}px`;
    }
    return style;
  }, [translatedScale]);
  const [mobileView, setMobileView] = useState('translated');
  const [latexTarget, setLatexTarget] = useState(null);
  const [exportError, setExportError] = useState('');
  const closeLatex = useCallback(() => setLatexTarget(null), []);
  const openLatex = event => {
    const element = event.target.closest?.('[data-latex]');
    if (!element || !event.currentTarget.contains(element)) return;
    if (event.type === 'keydown') {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      event.preventDefault();
    }
    setLatexTarget({ element, source: element.dataset.latex });
  };
  const originalRef = useRef(null);
  const translatedRef = useRef(null);
  const originalBlob = useRef(document.original).current;
  const displayPages = useMemo(() => visibleVisualPages(document.visualPages || []), [document.visualPages]);
  const inputs = useMemo(() => alignmentInputs(document.visualPages || []), [document.visualPages]);
  const alignedPages = useMemo(() => separatorAlignment(document.visualPages || [], document.sentenceAlignments),
    [document.visualPages, document.sentenceAlignments]);
  const hoverSentence = useCallback(id => highlightSentence(translatedRef.current, id), []);

  useEffect(() => { hoverSentence(null); }, [document.id, alignedPages, hoverSentence]);
  useEffect(closeLatex, [document.id, document.visualPages, originalScale, translatedScale, mobileView, closeLatex]);

  useEffect(() => {
    let active = true;
    getPdfPageInfo(originalBlob).then(result => { if (active) setPages(result); })
      .catch(error => { if (active) setPageError(error.message); });
    return () => { active = false; };
  }, [document.id]);

  useEffect(() => { void runVisualTranslation(document.id, settings?.key, { retry: Boolean(settings?.key) }); }, [document.id, settings?.key]);

  const updatePage = useCallback((version, root) => {
    const top = root.getBoundingClientRect().top + 40;
    const first = [...root.querySelectorAll('.pdf-page, .visual-page')].find(page => page.getBoundingClientRect().bottom > top);
    if (!first) return;
    const number = Number(first.dataset.page);
    if (!number) return;
    setActivePage(number);
    if (version === 'original' || version === 'translated') {
      setSidePages(current => current[version] === number ? current : { ...current, [version]: number });
    }
  }, []);

  const downloadJson = async (sentences = false) => {
    const payload = sentences ? exportAlignment(document.visualPages || [], alignedPages)
      : { pages: (document.visualPages || []).filter(Boolean).map(page => ({ page: page.number, paragraphs: page.paragraphs })) };
    setExportError('');
    try {
      await saveBlob(new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' }),
        `${document.filename.replace(/\.pdf$/i, '')}-${sentences ? 'sentence-alignment' : 'visual-translation'}.json`);
    } catch (error) { setExportError(`保存 JSON 失败：${error.message || error}`); }
  };

  return <div className="reader vision-reader">
    <header className="reader-toolbar">
      <ActionIcon variant="subtle" color="teal" aria-label={mobile ? '打开任务列表' : sidebarCollapsed ? '展开任务列表' : '折叠任务列表'}
        onClick={mobile ? onOpenTasks : onToggleSidebar}>
        {mobile ? <FileText size={18} /> : sidebarCollapsed ? <PanelLeftOpen size={18} /> : <PanelLeftClose size={18} />}
      </ActionIcon>
      {!translatedOnly && <SegmentedControl className="reader-mode-switch" size="xs" color="teal" value="visual" onChange={onModeChange}
        data={[{ label: '常规', value: 'standard' }, { label: '纯视觉识别', value: 'visual' }]} />}
      {!translatedOnly && <div className="page-count" aria-label="两侧页数"><span>左 {sidePages.original} <em>/ {pages.length || '…'}</em></span><span>右 {sidePages.translated} <em>/ {pages.length || '…'}</em></span></div>}
      <div className="zoom-controls">
        {(document.visualPages || []).some(Boolean) && <ActionIcon variant="subtle" color="teal" aria-label="下载对照 JSON" title="下载对照 JSON" onClick={() => downloadJson()}><Download size={18} /></ActionIcon>}
        {(alignedPages.some(Boolean) || inputs.some(input => !input.length)) && <ActionIcon variant="subtle" color="teal" aria-label="下载句级对照 JSON" title="下载句级对照 JSON" onClick={() => downloadJson(true)}><FileJson size={18} /></ActionIcon>}
        {document.visualPages?.[activePage - 1] && <ActionIcon variant="subtle" color="teal" aria-label="重新识别当前页" title="重新识别当前页" disabled={!settings?.key || document.visualStatus === 'working'}
          onClick={() => runVisualTranslation(document.id, settings.key, { retry: true, onlyPage: activePage, redoPage: true })}><RotateCcw size={18} /></ActionIcon>}
        {!translatedOnly && (!narrow || mobileView === 'original') &&
          <ZoomControls label="原件" scale={originalScale} onChange={setOriginalScale} />}
        {(translatedOnly || !narrow || mobileView === 'translated') &&
          <ZoomControls label="对照" scale={translatedScale} onChange={setTranslatedScale} />}
      </div>
    </header>
    <div className="reader-workspace">
      {pageError && <Alert color="red">PDF 无法打开：{pageError}</Alert>}
      {exportError && <Alert color="red" withCloseButton onClose={() => setExportError('')}>{exportError}</Alert>}
      {document.visualStatus === 'error' && <Alert color="red" className="vision-error">{document.visualError}<Button ml="sm" size="compact-sm" variant="white" onClick={() => runVisualTranslation(document.id, settings?.key, { retry: true })}>重试未完成页</Button></Alert>}
      {!translatedOnly && <div className="mobile-view-switch"><SegmentedControl value={mobileView} onChange={setMobileView}
        data={[{ label: 'PDF 原件', value: 'original' }, { label: '逐段对照', value: 'translated' }]} fullWidth size="xs" color="teal" /></div>}
      <div className={`vision-spread mobile-${mobileView} ${translatedOnly ? 'translated-only' : ''}`}>
        {!translatedOnly && <PdfPane version="original" blob={originalBlob} pages={pages} scale={originalScale} scrollRef={originalRef}
          onScroll={updatePage} onSentenceOpen={ignoreSentence} onSentenceHover={ignoreSentence} mobile={mobile} />}
        <div ref={translatedRef} className="visual-scroll" style={readingStyle} onClick={openLatex} onKeyDown={openLatex} onScroll={event => updatePage('translated', event.currentTarget)}>
          <div className="visual-progress">已完成 {(document.visualPages || []).filter(Boolean).length} / {pages.length || '…'} 页
            {document.visualActivePage && document.visualPages?.[document.visualActivePage - 1] ? ` · 正在重新识别第 ${document.visualActivePage} 页` : ''}
            {document.visualTokens?.total ? ` · ${document.visualTokens.total} token` : ''}</div>
          {pages.map(page => {
            const result = document.visualPages?.[page.number - 1];
            const visibleParagraphs = displayPages[page.number - 1] || [];
            return <section key={page.number} className="visual-page" data-page={page.number} aria-label={`第 ${page.number} 页译文`}>
              {result && document.visualPageErrors?.[page.number] && document.visualStatus !== 'working' &&
                <Alert color="red" mb="sm">重新识别失败：{document.visualPageErrors[page.number]}</Alert>}
              {result ? visibleParagraphs.length ? visibleParagraphs.map((paragraph, index) =>
                <VisualParagraph key={index} paragraph={paragraph} index={index} alignment={alignedPages[page.number - 1]}
                  onSentenceHover={hoverSentence} />) : <p className="visual-empty">此页无文字</p>
                : <div className="visual-pending">{document.visualStatus === 'working' && !document.visualPageErrors?.[page.number]
                  ? <><Loader size="xs" color="teal" /> 正在识别并翻译…</>
                  : document.visualPageErrors?.[page.number]
                    ? <>此页失败：{document.visualPageErrors[page.number]}
                      {document.visualStatus !== 'working' && <Button size="compact-xs" variant="light" color="teal"
                        onClick={() => runVisualTranslation(document.id, settings?.key, { retry: true, onlyPage: page.number })}>重试本页</Button>}</>
                    : document.visualStatus === 'error' ? '此页尚未完成' : '等待识别…'}</div>}
            </section>;
          })}
        </div>
      </div>
    </div>
    {latexTarget && <LatexSourcePopup key={latexTarget.source} target={latexTarget} onClose={closeLatex} />}
  </div>;
});
