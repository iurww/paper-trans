export function highlightSentence(root, id) {
  if (!root) return;
  for (const span of root.querySelectorAll('.visual-sentence')) {
    span.classList.toggle('active', Boolean(id) && span.dataset.sentence === id);
  }
}
