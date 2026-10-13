import { apiFetch } from '../platform/desktop.js';

export class RetryableTranslationError extends Error {}
export class TranslationConfigurationError extends Error {}

const pause = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));
const retryableStatus = status => status === 408 || status === 409 || status === 425 || status === 429 || status >= 500;

export async function request(messages, settings, fetchImpl = apiFetch, sleep = pause) {
  let lastError;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), settings.timeoutMs || 90000);
      let response;
      try {
        response = await fetchImpl(settings.endpoint, {
          method: 'POST',
          signal: controller.signal,
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${settings.key}` },
          body: JSON.stringify({
            model: settings.model,
            temperature: 0,
            response_format: { type: 'json_object' },
            ...(settings.maxTokens ? { max_tokens: settings.maxTokens } : {}),
            ...(settings.thinking ? { thinking: settings.thinking } : {}),
            messages,
          }),
        });
      } finally { clearTimeout(timeout); }
      if (response.ok) return await response.json();
      const body = await response.text();
      if (!retryableStatus(response.status)) {
        throw new TranslationConfigurationError(`翻译 API 返回 ${response.status}: ${body.slice(0, 180)}`);
      }
      lastError = new RetryableTranslationError(`翻译 API 暂时不可用 (${response.status})`);
      const retryAfter = Number(response.headers?.get?.('retry-after'));
      if (attempt < 2) await sleep(Number.isFinite(retryAfter) && retryAfter > 0 ? Math.min(retryAfter * 1000, 30000) : 1000 * 2 ** attempt);
    } catch (error) {
      if (error instanceof TranslationConfigurationError) throw error;
      lastError = error instanceof RetryableTranslationError ? error : new RetryableTranslationError('翻译 API 暂时无法连接，稍后自动重试');
      if (attempt < 2) await sleep(1000 * 2 ** attempt);
    }
  }
  throw lastError;
}

export function parseContent(content) {
  if (typeof content !== 'string') return null;
  const trimmed = content.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  try { return JSON.parse(trimmed); }
  catch {
    const start = trimmed.indexOf('{'), end = trimmed.lastIndexOf('}');
    if (start >= 0 && end > start) {
      try { return JSON.parse(trimmed.slice(start, end + 1)); } catch {}
    }
    return null;
  }
}

function validTranslation(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

async function resolveGroup(lines, settings, onResult, fetchImpl, sleep) {
  if (lines.length === 1) {
    const line = lines[0];
    for (let attempt = 0; attempt < 3; attempt++) {
      const data = await request([
        { role: 'system', content: 'Translate this academic sentence into Simplified Chinese. Return only JSON: {"translation":"..."}. Preserve the meaning, citations, and terminology.' },
        { role: 'user', content: line.source },
      ], settings, fetchImpl, sleep);
      const parsed = parseContent(data.choices?.[0]?.message?.content);
      const candidate = validTranslation(parsed?.translation) || validTranslation(parsed?.lines?.[0]?.translation);
      if (candidate) line.translation = candidate;
      await onResult(data.usage || {});
      if (candidate) return;
      if (attempt < 2) await sleep(500 * 2 ** attempt);
    }
    throw new RetryableTranslationError(`API 暂未返回 ${line.id} 的译文，正在自动重试`);
  }

  const data = await request([
    { role: 'system', content: 'Translate academic PDF sentences into Simplified Chinese. Return only JSON: {"lines":[{"id":"...","translation":"..."}]}. Each input item is a separate sentence; return EVERY input ID exactly once and keep sentence boundaries. Preserve meaning, citations, and terminology.' },
    { role: 'user', content: JSON.stringify({ lines: lines.map(({ id, source }) => ({ id, source })) }) },
  ], settings, fetchImpl, sleep);
  const parsed = parseContent(data.choices?.[0]?.message?.content);
  const byId = new Map((Array.isArray(parsed?.lines) ? parsed.lines : []).map(item => [item.id, validTranslation(item.translation)]));
  for (const line of lines) {
    const candidate = byId.get(line.id);
    if (candidate) line.translation = candidate;
  }
  await onResult(data.usage || {});
  const missing = lines.filter(line => !line.translation);
  if (!missing.length) return;
  const middle = Math.ceil(missing.length / 2);
  await resolveGroup(missing.slice(0, middle), settings, onResult, fetchImpl, sleep);
  if (middle < missing.length) await resolveGroup(missing.slice(middle), settings, onResult, fetchImpl, sleep);
}

export async function translateBatch(lines, settings, onResult, { fetchImpl = apiFetch, sleep = pause } = {}) {
  const remaining = lines.filter(line => !line.translation);
  if (remaining.length) await resolveGroup(remaining, settings, onResult, fetchImpl, sleep);
}
