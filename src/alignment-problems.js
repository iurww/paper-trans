import { alignmentCurrent, alignmentInputs, alignmentMatches } from './sentence-alignment.js';

export function alignmentProblems(record) {
  const inputs = alignmentInputs(record.visualPages || []);
  return (record.visualPages || []).flatMap((page, index) => {
    if (!page || alignmentMatches(record.sentenceAlignments?.[index], inputs[index])) return [];
    const alignment = record.sentenceAlignments?.[index];
    const completed = alignmentCurrent(alignment, inputs[index]) ? alignment.paragraphs : [];
    return [{ number: page.number,
      reason: record.alignmentPageErrors?.[page.number] || '此页的句级对照尚未完成，或页面内容变化后旧对照已失效。',
      paragraphs: inputs[index].filter(item => !completed.some(entry => entry.paragraph === item.paragraph)),
    }];
  });
}

export function alignmentProblemMessage(problems) {
  return `仍有 ${problems.length} 个已翻译页面缺少有效句级对照（PDF 第 ${problems.map(page => page.number).join('、')} 页），可重试未完成页。`;
}
