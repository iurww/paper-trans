import { useCallback, useEffect, useRef, useState } from 'react';

export function useSynchronizedScroll({ pageCount, overlayOpen, mobile, mobileView }) {
  const originalRef = useRef(null);
  const translatedRef = useRef(null);
  const activeVersion = useRef('original');
  const pageFrame = useRef(0);
  const pendingPages = useRef(new Map());
  const [sidePages, setSidePages] = useState({ original: 1, translated: 1 });

  const getPane = useCallback(version => version === 'translated' ? translatedRef.current : originalRef.current, []);
  const rememberPage = useCallback((version, pane) => {
    if (!pane || (version !== 'original' && version !== 'translated')) return;
    const top = pane.scrollTop + 24;
    const visible = [...pane.querySelectorAll('.pdf-page')].find(page => page.offsetTop + page.offsetHeight > top);
    const number = Number(visible?.dataset.page || pageCount);
    setSidePages(current => current[version] === number ? current : { ...current, [version]: number });
  }, [pageCount]);
  const updatePage = useCallback((version, pane) => {
    if (!pane) return;
    activeVersion.current = version;
    pendingPages.current.set(version, pane);
    if (!pageFrame.current) pageFrame.current = requestAnimationFrame(() => {
      pageFrame.current = 0;
      for (const [side, element] of pendingPages.current) rememberPage(side, element);
      pendingPages.current.clear();
    });
  }, [rememberPage]);

  useEffect(() => () => cancelAnimationFrame(pageFrame.current), []);

  const sync = useCallback((from, to) => {
    const source = getPane(from), target = getPane(to);
    if (!source || !target) return;
    const fraction = source.scrollTop / Math.max(1, source.scrollHeight - source.clientHeight);
    target.scrollTop = fraction * Math.max(0, target.scrollHeight - target.clientHeight);
    rememberPage(from, source);
    updatePage(to, target);
  }, [getPane, rememberPage, updatePage]);

  useEffect(() => {
    let frame = 0;
    let pending = null;
    const wheel = event => {
      if (event.ctrlKey || overlayOpen) return;
      const panes = [originalRef.current, translatedRef.current].filter(node => node?.getClientRects().length);
      if (!panes.length) return;
      const hovered = event.target instanceof Element ? event.target.closest('.pdf-scroll') : null;
      const source = panes.includes(hovered) ? hovered : panes.find(node => node.dataset.version === activeVersion.current) || panes[0];
      const distance = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? window.innerHeight : 1;
      event.preventDefault();
      if (pending?.source !== source) pending = { source, x: 0, y: 0 };
      pending.x += event.deltaX * distance;
      pending.y += event.deltaY * distance;
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        const { source, x, y } = pending;
        pending = null;
        source.scrollTop += y;
        source.scrollLeft += x;
        const vertical = source.scrollTop / Math.max(1, source.scrollHeight - source.clientHeight);
        const horizontal = source.scrollLeft / Math.max(1, source.scrollWidth - source.clientWidth);
        for (const target of panes) if (target !== source) {
          target.scrollTop = vertical * Math.max(0, target.scrollHeight - target.clientHeight);
          target.scrollLeft = horizontal * Math.max(0, target.scrollWidth - target.clientWidth);
        }
        activeVersion.current = source.dataset.version || activeVersion.current;
      });
    };
    window.addEventListener('wheel', wheel, { passive: false });
    return () => { window.removeEventListener('wheel', wheel); cancelAnimationFrame(frame); };
  }, [overlayOpen, rememberPage]);

  useEffect(() => {
    if (mobile) updatePage(mobileView, getPane(mobileView));
  }, [mobile, mobileView, getPane, updatePage]);

  const setActiveVersion = version => { activeVersion.current = version; };
  return { originalRef, translatedRef, sidePages, updatePage, sync, setActiveVersion };
}
