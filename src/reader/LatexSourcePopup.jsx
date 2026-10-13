import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Check, Copy, LoaderCircle, X } from 'lucide-react';

async function copySource(source) {
  try {
    await navigator.clipboard.writeText(source);
    return;
  } catch { /* Older browsers and HTTP pages need the selection fallback. */ }
  const focused = document.activeElement;
  const field = document.createElement('textarea');
  field.value = source;
  field.style.cssText = 'position:fixed;left:-9999px;top:0';
  document.body.append(field);
  try {
    field.select();
    if (!document.execCommand('copy')) throw new Error('Copy failed');
  } finally {
    field.remove();
    focused?.focus({ preventScroll: true });
  }
}

export default function LatexSourcePopup({ target, onClose }) {
  const root = useRef(null);
  const [position, setPosition] = useState({ left: 8, top: 8 });
  const [status, setStatus] = useState('');
  const [copying, setCopying] = useState(false);
  const copyLabel = copying ? '正在复制' : status === 'success' ? '已复制' : status === 'error' ? '复制失败，请选择源码手动复制' : '复制 LaTeX 源码';

  useEffect(() => {
    if (!status) return;
    const timer = setTimeout(() => setStatus(''), 2000);
    return () => clearTimeout(timer);
  }, [status]);

  useLayoutEffect(() => {
    const anchor = target.element.getBoundingClientRect();
    const box = root.current.getBoundingClientRect();
    const left = Math.max(8, Math.min(anchor.left, window.innerWidth - box.width - 8));
    const below = anchor.bottom + 8;
    const top = below + box.height <= window.innerHeight - 8 ? below : anchor.top - box.height - 8;
    setPosition({ left, top: Math.max(8, Math.min(top, window.innerHeight - box.height - 8)) });
  }, [target]);

  useEffect(() => {
    const dismiss = event => {
      if (!root.current?.contains(event.target) && !target.element.contains(event.target)) onClose();
    };
    const escape = event => { if (event.key === 'Escape') { onClose(); target.element.focus({ preventScroll: true }); } };
    const scroll = event => { if (!root.current?.contains(event.target)) onClose(); };
    document.addEventListener('pointerdown', dismiss);
    document.addEventListener('keydown', escape);
    window.addEventListener('scroll', scroll, true);
    window.addEventListener('resize', onClose);
    return () => {
      document.removeEventListener('pointerdown', dismiss);
      document.removeEventListener('keydown', escape);
      window.removeEventListener('scroll', scroll, true);
      window.removeEventListener('resize', onClose);
    };
  }, [target, onClose]);

  return createPortal(<div ref={root} className="latex-source-popup" role="dialog" aria-label="LaTeX 源码" style={position}>
    <div className="latex-source-row">
      <pre tabIndex={0}>{target.source}</pre>
      <button type="button" disabled={copying} data-status={status} aria-label={copyLabel} title={copyLabel} onClick={async () => {
        setStatus('');
        setCopying(true);
        try { await copySource(target.source); setStatus('success'); }
        catch { setStatus('error'); }
        finally { setCopying(false); }
      }}>{copying ? <LoaderCircle size={16} /> : status === 'success' ? <Check size={16} /> : status === 'error' ? <X size={16} /> : <Copy size={16} />}</button>
    </div>
  </div>, document.body);
}
