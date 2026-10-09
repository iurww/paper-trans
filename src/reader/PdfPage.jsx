import { memo, useEffect, useMemo, useRef, useState } from 'react';
import { renderPage } from '../pdf.js';

function collectZones(page, version) {
  if (page.blocks) return page.blocks.flatMap(block => block.sentences.flatMap(sentence =>
    (version === 'original' ? sentence.source_rects : sentence.translation_rects || [])
      .map(rect => ({ rect, sentence }))));
  return (page.lines || []).filter(line => line.translate && line.translation)
    .map(line => ({ rect: line.rect, sentence: line }));
}

export default memo(function PdfPage({ page, pdf, version, scale, visible, onSentenceOpen, onSentenceHover, mobile }) {
  const paperRef = useRef(null);
  const canvasRef = useRef(null);
  const renderQueue = useRef(Promise.resolve());
  const rendered = useRef(null);
  const [width, setWidth] = useState(0);
  const [error, setError] = useState('');
  const zones = useMemo(() => collectZones(page, version), [page, version]);

  useEffect(() => {
    const paper = paperRef.current;
    if (!paper) return;
    const observer = new ResizeObserver(() => setWidth(Math.round(paper.clientWidth)));
    observer.observe(paper);
    setWidth(Math.round(paper.clientWidth));
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!visible || !pdf || !width || rendered.current?.pdf === pdf && rendered.current?.width === width) return;
    let cancelled = false;
    renderQueue.current = renderQueue.current.catch(() => {}).then(async () => {
      if (cancelled || !canvasRef.current) return;
      await renderPage(pdf, page.number, canvasRef.current, width);
      if (!cancelled) { rendered.current = { pdf, width }; setError(''); }
    }).catch(error => { if (!cancelled) setError(error.message); });
    return () => { cancelled = true; };
  }, [visible, pdf, width, page.number]);

  return <div ref={paperRef} className="pdf-page" data-page={page.number}
    style={{ width: `${scale * 100}%`, aspectRatio: `${page.width} / ${page.height}` }}>
    <canvas ref={canvasRef} aria-label={`第 ${page.number} 页${version === 'original' ? '原文' : '译文'}`} />
    {error && <span className="pdf-page-error">页面渲染失败：{error}</span>}
    {visible && <div className="pdf-overlay">{zones.map(({ rect, sentence }, index) => {
      const [x0, y0, x1, y1] = rect;
      return <span key={`${sentence.id}-${index}`} className="sentence-zone" data-sentence={sentence.id}
        title={sentence.translation}
        style={{ left: `${100 * x0 / page.width}%`, top: `${100 * y0 / page.height}%`,
          width: `${100 * (x1 - x0) / page.width}%`, height: `${100 * (y1 - y0) / page.height}%` }}
        onPointerEnter={() => onSentenceHover(sentence.id)} onPointerLeave={() => onSentenceHover(null)}
        onDoubleClick={mobile ? undefined : () => onSentenceOpen(sentence)}
        onClick={mobile ? () => onSentenceOpen(sentence) : undefined} />;
    })}</div>}
  </div>;
});
