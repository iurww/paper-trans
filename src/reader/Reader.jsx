import { memo, useCallback, useRef, useState } from 'react';
import { ActionIcon, Modal, SegmentedControl, Text } from '@mantine/core';
import { useMediaQuery } from '@mantine/hooks';
import { ArrowLeft, ArrowRight, FileText, PanelLeftClose, PanelLeftOpen, ZoomIn, ZoomOut } from 'lucide-react';
import PdfPane from './PdfPane.jsx';
import VisionReader from './VisionReader.jsx';
import { useSynchronizedScroll } from './useSynchronizedScroll.js';

export default memo(function Reader({ overlayOpen, ...props }) {
  return props.mode === 'visual' ? <VisionReader {...props} /> : <StandardReader {...props} overlayOpen={overlayOpen} />;
});

function StandardReader({ document, sidebarCollapsed, onToggleSidebar, onOpenTasks, overlayOpen, onModeChange = () => {} }) {
  const mobile = useMediaQuery('(max-width: 760px)');
  const [scale, setScale] = useState(1);
  const [mobileView, setMobileView] = useState('original');
  const [popup, setPopup] = useState(null);
  const readerRef = useRef(null);
  const { originalRef, translatedRef, sidePages, updatePage, sync, setActiveVersion } = useSynchronizedScroll({
    pageCount: document.pages.length, overlayOpen: overlayOpen || Boolean(popup), mobile, mobileView,
  });

  const highlight = useCallback(id => {
    const root = readerRef.current;
    if (!root) return;
    root.querySelectorAll('.sentence-zone.active').forEach(zone => zone.classList.remove('active'));
    if (id) root.querySelectorAll('.sentence-zone').forEach(zone => {
      if (zone.dataset.sentence === id) zone.classList.add('active');
    });
  }, []);

  return <div ref={readerRef} className="reader">
    <header className="reader-toolbar">
      <ActionIcon variant="subtle" color="teal" aria-label={mobile ? '打开任务列表' : sidebarCollapsed ? '展开任务列表' : '折叠任务列表'}
        onClick={mobile ? onOpenTasks : onToggleSidebar}>
        {mobile ? <FileText size={18} /> : sidebarCollapsed ? <PanelLeftOpen size={18} /> : <PanelLeftClose size={18} />}
      </ActionIcon>
      <SegmentedControl className="reader-mode-switch" size="xs" color="teal" value="standard" onChange={onModeChange}
        data={[{ label: '常规', value: 'standard' }, { label: '纯视觉识别', value: 'visual' }]} />
      <div className="page-count" aria-label="两侧页数"><span>左 {sidePages.original} <em>/ {document.pages.length}</em></span><span>右 {sidePages.translated} <em>/ {document.pages.length}</em></span></div>
      <div className="zoom-controls">
        <ActionIcon variant="subtle" color="teal" aria-label="缩小" onClick={() => setScale(value => Math.max(.75, value - .25))}><ZoomOut size={18} /></ActionIcon>
        <ActionIcon variant="subtle" color="teal" aria-label="放大" onClick={() => setScale(value => Math.min(2.5, value + .25))}><ZoomIn size={18} /></ActionIcon>
      </div>
    </header>
    <div className="reader-workspace">
      <div className="mobile-view-switch"><SegmentedControl value={mobileView} onChange={value => { setMobileView(value); setActiveVersion(value); }}
        data={[{ label: '原文', value: 'original' }, { label: '译文', value: 'translated' }]} fullWidth size="xs" color="teal" /></div>
      <div className={`reader-spread mobile-${mobileView}`}>
        <PdfPane version="original" blob={document.original} pages={document.pages} scale={scale} scrollRef={originalRef}
          onScroll={updatePage} onSentenceOpen={setPopup} onSentenceHover={highlight} mobile={mobile} />
        <div className="sync-controls">
          <ActionIcon variant="default" aria-label="将右侧对齐到左侧" title="将右侧对齐到左侧" onClick={() => sync('original', 'translated')}><ArrowRight size={18} /></ActionIcon>
          <ActionIcon variant="default" aria-label="将左侧对齐到右侧" title="将左侧对齐到右侧" onClick={() => sync('translated', 'original')}><ArrowLeft size={18} /></ActionIcon>
        </div>
        <PdfPane version="translated" blob={document.translated} pages={document.pages} scale={scale} scrollRef={translatedRef}
          onScroll={updatePage} onSentenceOpen={setPopup} onSentenceHover={highlight} mobile={mobile} />
      </div>
    </div>
    <Modal lockScroll={false} opened={Boolean(popup)} onClose={() => setPopup(null)} title="译文" centered size="md">
      <Text className="popup-translation">{popup?.translation}</Text>
      <details><summary>查看原文</summary><Text size="sm" c="dimmed" mt="sm">{popup?.source}</Text></details>
    </Modal>
  </div>;
}
