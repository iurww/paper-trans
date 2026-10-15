import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { PDFDocument } from 'pdf-lib';

const home = process.argv[2];
const root = join(home, 'Documents/PaperLens/default');
const dir = join(root, 'performance--audit');
await mkdir(dir, { recursive: true });
await writeFile(join(root, '.folder.json'), JSON.stringify({ id: 'default', name: 'default' }));
const pdf = await PDFDocument.create();
const pages = [];
for (let i = 1; i <= 66; i++) {
  const page = pdf.addPage([612, 792]);
  page.drawText(`PaperLens performance fixture - page ${i}`, { x: 36, y: 750, size: 14 });
  for (let row = 0; row < 36; row++) {
    page.drawText(`Section ${row}: Neural network optimization and evaluation on real data.`, { x: 36, y: 720 - row * 18, size: 10 });
  }
  pages.push({ number: i, width: 612, height: 792, blocks: [] });
}
await writeFile(join(dir, 'original.pdf'), await pdf.save());
const paragraphs = Array.from({ length: 10 }, (_, i) => ({
  kind: 'paragraph',
  original: `Paragraph ${i}: A study of neural network architecture and transit planning uses $x^2+y^2=z^2$. The optimization problem is analyzed with several methods and evaluated using real data.`,
  chinese: `第${i}段：研究神经网络架构及交通规划，公式为$x^2+y^2=z^2$。使用真实数据评估优化方法和结果。`,
}));
await writeFile(join(dir, 'translation.json'), JSON.stringify({
  schemaVersion: 1, hasTranslatedPdf: false, id: 'performance-audit', filename: 'Performance audit.pdf',
  folderId: 'default', createdAt: 1, mode: 'visual', status: 'visual', pages,
  metadata: { title: 'Performance audit', pageCount: 66 },
  visualStatus: 'done', visualPageCount: 66,
  visualPages: pages.map(page => ({ number: page.number, paragraphs })),
}));
