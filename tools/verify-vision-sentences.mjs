// Run real page screenshots through the production API and alignment functions.
// node tools/verify-vision-sentences.mjs manifest.json output-directory disabled,enabled
// Manifest: [{ id, pdf, page }]. Reads DEEPSEEK_API_KEY from env or local .env.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { translateVisualPage } from '../src/translation/vision-api.js';
import { separatorAlignment } from '../src/alignment/sentence-alignment.js';
import { sentenceCandidates } from './sentence-audit.js';
import { splitSentenceSegments } from '../src/alignment/sentence-separator.js';

const [manifestFile, outputDirectory, modes = 'disabled,enabled'] = process.argv.slice(2);
if (!manifestFile || !outputDirectory) throw new Error('Usage: node tools/verify-vision-sentences.mjs manifest.json output-directory [disabled,enabled]');
const env = fs.existsSync('.env') ? Object.fromEntries(fs.readFileSync('.env', 'utf8').split('\n')
  .filter(line => /^[A-Z_]+=/.test(line)).map(line => {
    const at = line.indexOf('='); return [line.slice(0, at), line.slice(at + 1).trim().replace(/^['"]|['"]$/g, '')];
  })) : {};
const key = process.env.DEEPSEEK_API_KEY || env.DEEPSEEK_API_KEY;
if (!key) throw new Error('DEEPSEEK_API_KEY is required');
const samples = JSON.parse(fs.readFileSync(manifestFile, 'utf8'));
fs.mkdirSync(outputDirectory, { recursive: true });
for (const sample of samples) {
  if (!/^[a-z0-9_-]+$/i.test(sample.id) || !Number.isInteger(sample.page) || sample.page < 1) throw new Error('Invalid sample');
  const prefix = path.join(outputDirectory, sample.id);
  execFileSync('pdftoppm', ['-f', String(sample.page), '-l', String(sample.page), '-scale-to', '2200', '-jpeg', '-singlefile', sample.pdf, prefix]);
}
const jobs = samples.flatMap(sample => modes.split(',').map(thinking => ({ ...sample, thinking })));
const summaries = [];
let cursor = 0;
async function worker() {
  while (cursor < jobs.length) {
    const job = jobs[cursor++];
    const stem = path.join(outputDirectory, `${job.id}-${job.thinking}`);
    if (fs.existsSync(`${stem}.summary.json`)) {
      summaries.push(JSON.parse(fs.readFileSync(`${stem}.summary.json`, 'utf8'))); continue;
    }
    let requests = 0, reasoningChars = 0;
    const started = Date.now();
    try {
      const result = await translateVisualPage('data:image/jpeg;base64,' + fs.readFileSync(path.join(outputDirectory, `${job.id}.jpg`)).toString('base64'), key, {
        thinking: job.thinking,
        fetchImpl: async (...args) => {
          requests++;
          const body = JSON.parse(args[1].body);
          fs.writeFileSync(`${stem}.request-${requests}.json`, JSON.stringify({ model: body.model, thinking: body.thinking, max_tokens: body.max_tokens, prompt: body.messages[0].content[0].text }, null, 2));
          const response = await fetch(...args);
          if (response.ok) {
            const raw = await response.clone().json();
            // Keep returned content/usage for inspection, not internal reasoning.
            reasoningChars += raw.choices?.[0]?.message?.reasoning_content?.length || 0;
            for (const choice of raw.choices || []) if (choice.message) delete choice.message.reasoning_content;
            fs.writeFileSync(`${stem}.response-${requests}.json`, JSON.stringify(raw, null, 2));
          }
          return response;
        },
      });
      const pages = Array.from({ length: job.page }, (_, index) => index + 1 === job.page
        ? { number: job.page, paragraphs: result.paragraphs } : undefined);
      const alignment = separatorAlignment(pages)[job.page - 1];
      fs.writeFileSync(`${stem}.translation.json`, JSON.stringify({ pages: [{ page: job.page, paragraphs: result.paragraphs }] }, null, 2));
      fs.writeFileSync(`${stem}.alignment.json`, JSON.stringify(alignment, null, 2));
      const details = result.paragraphs.map((item, index) => ({ paragraph: index + 1, kind: item.kind,
        originalGroups: splitSentenceSegments(item.original).length, chineseGroups: splitSentenceSegments(item.chinese).length,
        // Screening only; human review makes the final semantic judgment.
        candidateOriginalSentences: sentenceCandidates(item.original).length,
        original: item.original, chinese: item.chinese }));
      const bilingual = details.filter(item => item.chinese);
      const summary = { ...job, requests, reasoningChars, milliseconds: Date.now() - started, usage: result.usage,
        paragraphs: details.length, bilingual: bilingual.length,
        unequal: bilingual.filter(item => item.originalGroups !== item.chineseGroups).map(item => item.paragraph),
        suspectUnsplit: bilingual.filter(item => item.originalGroups === 1 && item.candidateOriginalSentences > 1).map(item => item.paragraph),
        validSentenceParagraphs: alignment.paragraphs.filter(item => !item.granularity).length,
        details };
      fs.writeFileSync(`${stem}.summary.json`, JSON.stringify(summary, null, 2));
      summaries.push(summary);
      console.log(JSON.stringify({ id: job.id, thinking: job.thinking, requests, bilingual: summary.bilingual, unequal: summary.unequal, suspectUnsplit: summary.suspectUnsplit, validSentenceParagraphs: summary.validSentenceParagraphs, seconds: Math.round(summary.milliseconds / 1000), reasoningChars }));
    } catch (error) {
      const failure = { ...job, requests, error: error.message, milliseconds: Date.now() - started };
      fs.writeFileSync(`${stem}.error.json`, JSON.stringify(failure, null, 2));
      summaries.push(failure); console.log(JSON.stringify(failure));
    }
    fs.writeFileSync(path.join(outputDirectory, 'summary.json'), JSON.stringify(summaries, null, 2));
  }
}
await Promise.all([worker(), worker(), worker(), worker()]);
fs.writeFileSync(path.join(outputDirectory, 'summary.json'), JSON.stringify(summaries, null, 2));
