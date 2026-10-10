export async function processVisualPages(pageCount, {
  onlyPage = null, hasResult, onStart, translate, onSuccess, onFailure,
}) {
  const numbers = [];
  for (let number = 1; number <= pageCount; number++) {
    if (!onlyPage || number === onlyPage) numbers.push(number);
  }
  const pending = (await Promise.all(numbers.map(async number => await hasResult(number) ? 0 : number))).filter(Boolean);
  await Promise.all(pending.map(async number => {
    await onStart(number);
    try {
      await onSuccess(number, await translate(number));
    } catch (error) {
      await onFailure(number, error);
    }
  }));
}
