(async () => {
  if (window.__paperlensAudit) return;
  window.__paperlensAudit = true;
  const report = value => fetch('__REPORT_URL__', { method: 'POST', mode: 'no-cors', body: JSON.stringify(value) });
  const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
  const frame = () => new Promise(requestAnimationFrame);
  const waitFor = async selector => {
    const end = performance.now() + 30000;
    while (performance.now() < end) {
      const node = document.querySelector(selector);
      if (node) return node;
      await pause(50);
    }
    throw new Error(`Timed out waiting for ${selector}: ${document.body.innerText.slice(0, 500)}`);
  };
  try {
    await waitFor('.folder-item');
    document.querySelector('.folder-item').click();
    (await waitFor('.task-item')).click();
    await waitFor('.visual-page [data-latex]');
    await document.fonts.ready;
    await pause(2500);
    const panes = [...document.querySelectorAll('.pdf-scroll,.visual-scroll')];
    const samples = [];
    let previous = await frame(), maxCanvasBytes = 0, maxCanvases = 0;
    // A continuous down/up sweep, rather than racing to the bottom and then
    // measuring idle frames for the remainder of the test.
    for (let i = 0; i < 240; i++) {
      const now = await frame();
      samples.push(now - previous); previous = now;
      for (const pane of panes) pane.scrollTop += (i < 120 ? 1 : -1) * 120;
      const canvases = [...document.querySelectorAll('.pdf-page canvas')].filter(c => c.width && c.height);
      maxCanvases = Math.max(maxCanvases, canvases.length);
      maxCanvasBytes = Math.max(maxCanvasBytes, canvases.reduce((sum, c) => sum + c.width * c.height * 4, 0));
    }
    const sorted = samples.slice(5).sort((a, b) => a - b);
    await report({ type: 'scroll', p50ms: sorted[Math.floor(sorted.length * .5)],
      p95ms: sorted[Math.floor(sorted.length * .95)], maxMs: sorted.at(-1),
      framesOver50ms: sorted.filter(ms => ms > 50).length, samples: sorted.length,
      maxCanvases, maxCanvasMiB: maxCanvasBytes / 1024 / 1024,
      errors: [...document.querySelectorAll('.pdf-page-error')].map(node => node.textContent),
      userAgent: navigator.userAgent, dpr: devicePixelRatio });
    for (const label of ['新建翻译', 'API 设置', '论文详情']) {
      const trials = [];
      for (let trial = 0; trial < 3; trial++) {
        const button = label === '论文详情'
          ? document.querySelector('.task-sidebar:not(.task-sidebar-mobile) button[aria-label^="查看 "]')
          : [...document.querySelectorAll('.task-sidebar:not(.task-sidebar-mobile) button')].find(b => b.textContent.trim() === label);
        let previous = await frame();
        const start = performance.now(), intervals = [];
        button.click();
        let firstPaint;
        for (let i = 0; i < 30; i++) {
          const now = await frame(); intervals.push(now - previous); previous = now;
          const dialog = document.querySelector('[role="dialog"]');
          if (dialog?.getBoundingClientRect().height && Number(getComputedStyle(dialog).opacity) > 0 && firstPaint === undefined) firstPaint = now - start;
        }
        const sorted = intervals.sort((a, b) => a - b);
        trials.push({ firstPaintMs: firstPaint ?? null, p95ms: sorted[Math.floor(sorted.length * .95)], maxMs: sorted.at(-1) });
        if (label === '论文详情') button.click();
        else document.querySelector('.mantine-Modal-close').click();
        await pause(400);
      }
      await report({ type: 'modal', label, trials });
    }
    await report({ type: 'done' });
  } catch (error) { await report({ type: 'error', message: String(error), stack: error.stack }); }
})();
