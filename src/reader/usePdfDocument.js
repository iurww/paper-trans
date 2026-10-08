import { useEffect, useState } from 'react';
import { openPdf } from '../pdf.js';

export function usePdfDocument(blob) {
  const [state, setState] = useState({ pdf: null, error: null });
  useEffect(() => {
    let active = true;
    let loaded;
    setState({ pdf: null, error: null });
    (async () => {
      try {
        const pdf = await openPdf(new Uint8Array(await blob.arrayBuffer()));
        if (active) { loaded = pdf; setState({ pdf, error: null }); }
        else pdf.destroy();
      } catch (error) { if (active) setState({ pdf: null, error }); }
    })();
    return () => { active = false; loaded?.destroy(); };
  }, [blob]);
  return state;
}
