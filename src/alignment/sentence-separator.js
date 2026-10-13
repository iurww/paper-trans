// Reserved protocol token, matched literally rather than as generic brackets.
// Keep the first protocol readable for already saved translation JSON files.
export const SENTENCE_SEPARATOR = '[[[s:7e9c2a]]]';
export const LEGACY_SENTENCE_SEPARATOR = '[[[PL_SENTENCE_7e9c2a61-4b83-46d5-a012-9f60c38de724]]]';
const separatorPattern = /\[\[\[(?:s:7e9c2a|PL_SENTENCE_7e9c2a61-4b83-46d5-a012-9f60c38de724)\]\]\]/;
export const splitSentenceSegments = text => text.split(separatorPattern);
export const stripSentenceSeparators = text => splitSentenceSegments(text).join('');
