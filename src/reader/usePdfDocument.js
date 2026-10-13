import { useEffect, useState } from 'react';
import { openPdf } from '../pdf/pdf.js';

function releasePdf(pdf) {
  void pdf.loadingTask.destroy().catch(() => {});
}

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
        else releasePdf(pdf);
      } catch (error) { if (active) setState({ pdf: null, error }); }
    })();
    return () => { active = false; if (loaded) releasePdf(loaded); };
  }, [blob]);
  return state;
}
