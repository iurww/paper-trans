import { useCallback, useEffect, useRef, useState } from 'react';

export function useSynchronizedScroll({ pageCount, overlayOpen, mobile, mobileView }) {
  const originalRef = useRef(null);
  const translatedRef = useRef(null);
  const activeVersion = useRef('original');
  const [currentPage, setCurrentPage] = useState(1);

  const getPane = useCallback(version => version === 'translated' ? translatedRef.current : originalRef.current, []);
  const updatePage = useCallback((version, pane) => {
    if (!pane) return;
    activeVersion.current = version;
    const top = pane.scrollTop + 24;
    const visible = [...pane.querySelectorAll('.pdf-page')].find(page => page.offsetTop + page.offsetHeight > top);
    setCurrentPage(Number(visible?.dataset.page || pageCount));
  }, [pageCount]);

  const sync = useCallback((from, to) => {
    const source = getPane(from), target = getPane(to);
    if (!source || !target) return;
    const fraction = source.scrollTop / Math.max(1, source.scrollHeight - source.clientHeight);
    target.scrollTop = fraction * Math.max(0, target.scrollHeight - target.clientHeight);
    updatePage(to, target);
  }, [getPane, updatePage]);

  useEffect(() => {
    const wheel = event => {
      if (event.ctrlKey || overlayOpen) return;
      const panes = [originalRef.current, translatedRef.current].filter(node => node?.getClientRects().length);
      if (!panes.length) return;
      const hovered = event.target instanceof Element ? event.target.closest('.pdf-scroll') : null;
      const source = panes.includes(hovered) ? hovered : panes.find(node => node.dataset.version === activeVersion.current) || panes[0];
      const distance = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? window.innerHeight : 1;
      event.preventDefault();
      source.scrollTop += event.deltaY * distance;
      source.scrollLeft += event.deltaX * distance;
      const vertical = source.scrollTop / Math.max(1, source.scrollHeight - source.clientHeight);
      const horizontal = source.scrollLeft / Math.max(1, source.scrollWidth - source.clientWidth);
      for (const target of panes) if (target !== source) {
        target.scrollTop = vertical * Math.max(0, target.scrollHeight - target.clientHeight);
        target.scrollLeft = horizontal * Math.max(0, target.scrollWidth - target.clientWidth);
      }
      updatePage(source.dataset.version, source);
    };
    window.addEventListener('wheel', wheel, { passive: false });
    return () => window.removeEventListener('wheel', wheel);
  }, [overlayOpen, updatePage]);

  useEffect(() => {
    if (mobile) updatePage(mobileView, getPane(mobileView));
  }, [mobile, mobileView, getPane, updatePage]);

  const setActiveVersion = version => { activeVersion.current = version; };
  return { originalRef, translatedRef, currentPage, updatePage, sync, setActiveVersion };
}
