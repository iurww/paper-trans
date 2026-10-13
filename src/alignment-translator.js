import { getDocument, updateDocument } from './storage.js';
import { notifyChange } from './translator.js';
import { createAlignmentRunner } from './alignment-runner.js';

export const runSentenceAlignment = createAlignmentRunner({ get: getDocument, update: updateDocument, notify: notifyChange });
