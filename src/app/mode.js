export function hasModeResult(record, mode) {
  if (!record) return false;
  if (mode === 'standard') return Boolean(record.translated && record.pages);
  if (mode === 'visual') return ['done', 'working'].includes(record.visualStatus) && Array.isArray(record.visualPages)
    && record.visualPages.length > 0
    && (!record.visualPageCount || record.visualPages.length === record.visualPageCount)
    && Array.from(record.visualPages).every(page => Array.isArray(page?.paragraphs));
  return false;
}
