export const label = document => document.filename.replace(/\.pdf$/i, '');
export const status = document => document.mode === 'visual' ? ({
  done: '视觉识别完成', working: '视觉识别中', error: '视觉识别失败',
})[document.visualStatus] || '等待视觉识别' : ({
  queued: '排队中', extracting: '解析中', translating: '翻译中',
  retrying: '等待自动重试', typesetting: '排版中', done: '已完成', error: '失败',
})[document.status] || document.status;

export const tokenCount = value => Number(value || 0).toLocaleString();
export const tokenKilos = value => `${Math.round(Number(value || 0) / 1000)}k`;
export const tokenSummary = document =>
  `Token ${tokenCount(document.tokens?.total)}（输入 ${tokenCount(document.tokens?.prompt)} · 输出 ${tokenCount(document.tokens?.completion)}）`;

export function downloadTranslation(document) {
  if (!document?.translated) return;
  const url = URL.createObjectURL(document.translated);
  const link = window.document.createElement('a');
  link.href = url;
  link.download = `${label(document)}-译文.pdf`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}
