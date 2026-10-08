import { memo, useEffect, useState } from 'react';
import { Alert, Loader } from '@mantine/core';
import PdfPage from './PdfPage.jsx';
import { usePdfDocument } from './usePdfDocument.js';

export default memo(function PdfPane({ version, blob, pages, scale, scrollRef, onScroll, onSentenceOpen, onSentenceHover, mobile }) {
  const { pdf, error } = usePdfDocument(blob);
  const [visible, setVisible] = useState(() => new Set());

  useEffect(() => {
    const root = scrollRef.current;
    if (!root) return;
    const observer = new IntersectionObserver(entries => {
      setVisible(previous => {
        let changed = false;
        const next = new Set(previous);
        for (const entry of entries) if (entry.isIntersecting) {
          const number = Number(entry.target.dataset.page);
          if (!next.has(number)) { next.add(number); changed = true; }
        }
        return changed ? next : previous;
      });
    }, { root, rootMargin: '500px' });
    root.querySelectorAll('.pdf-page').forEach(page => observer.observe(page));
    return () => observer.disconnect();
  }, [scrollRef, pages]);

  return <div className={`pdf-pane ${version}`}>
    <div ref={scrollRef} className="pdf-scroll" data-version={version} onScroll={event => onScroll(version, event.currentTarget)}>
      {pages.map(page => <PdfPage key={page.number} page={page} pdf={pdf} version={version} scale={scale}
        visible={visible.has(page.number)}
        onSentenceOpen={onSentenceOpen} onSentenceHover={onSentenceHover} mobile={mobile} />)}
    </div>
    {!pdf && !error && <div className="pdf-loading"><Loader color="teal" size="sm" /></div>}
    {error && <Alert color="red" className="pdf-load-error">PDF 无法打开：{error.message}</Alert>}
  </div>;
});
