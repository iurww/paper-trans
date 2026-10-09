import { TranslationConfigurationError } from './translation-api.js';

export async function processVisualPages(pageCount, {
  onlyPage = null, hasResult, onStart, translate, onSuccess, onFailure,
}) {
  for (let number = 1; number <= pageCount; number++) {
    if (onlyPage && number !== onlyPage || await hasResult(number)) continue;
    await onStart(number);
    let result;
    try {
      result = await translate(number);
    } catch (error) {
      await onFailure(number, error);
      if (error instanceof TranslationConfigurationError) break;
      continue;
    }
    await onSuccess(number, result);
  }
}
