const pageNumber = /^(?:page\s*)?\d{1,4}$/i;
const referencesHeading = /^(?:references|bibliography|literature cited|参考文献)$/i;
const numberedReference = /^\[\d{1,3}\]\s+\S/;
const appendixHeading = /^(?:appendix\b|[A-Z](?:\.[0-9]+)?\s+[A-Z])/i;
const abstractHeading = /^(?:abstract\b|摘要|(?:\d+(?:\.\d+)*\s+)?introduction\b)/i;
const affiliation = /\b(?:university|institute|institution|department|college|school of|research (?:center|centre|lab)|laboratory|academy|faculty|biohub)\b/i;
const authorName = /\b[A-Z][a-z]+(?:\s+[A-Z][a-z]+){1,2}\b/g;
export const originalOnlyKinds = new Set(['author', 'affiliation', 'contact', 'reference']);

export function isOriginalOnlyVisualItem(item) {
  const original = typeof item?.original === 'string' ? item.original.trim() : '';
  return originalOnlyKinds.has(item?.kind) || numberedReference.test(original) ||
    ((item?.kind === 'heading' || item?.kind === 'title') && referencesHeading.test(original));
}

function frontMatterMetadata(original) {
  if (original.length > 220) return false;
  if (/@/.test(original) || affiliation.test(original)) return true;
  if (/[.!?。！？]$/.test(original)) return false;
  const names = [...original.matchAll(authorName)];
  return names.length >= 2 && /[,，;；∗*†‡]|\\quad|\s+and\s+/i.test(original);
}

export function omitVisualItem(item) {
  if (!item) return false;
  if (item.kind === 'table') return true;
  const original = typeof item.original === 'string' ? item.original.trim() : '';
  if (pageNumber.test(original)) return true;
  return false;
}

export function visibleVisualPages(visualPages = []) {
  let inReferences = false;
  let beforeAbstract = true;
  return Array.from(visualPages, (page, pageIndex) => (page?.paragraphs || []).flatMap(item => {
    const original = typeof item?.original === 'string' ? item.original.trim() : '';
    const heading = item?.kind === 'heading' || item?.kind === 'title';
    if (pageIndex === 0) {
      if (abstractHeading.test(original)) beforeAbstract = false;
    }
    if (heading && referencesHeading.test(original)) inReferences = true;
    if (inReferences && heading && appendixHeading.test(original)) inReferences = false;
    if (omitVisualItem(item)) return [];
    const originalOnly = inReferences || isOriginalOnlyVisualItem(item) ||
      (pageIndex === 0 && beforeAbstract && item?.kind !== 'title' && frontMatterMetadata(original));
    return [originalOnly ? { ...item, originalOnly: true } : item];
  }));
}
