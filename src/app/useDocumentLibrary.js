import { useCallback, useEffect, useRef, useState } from 'react';
import { listDocuments, putDocument } from '../storage.js';
import { MAX_PENDING, runQueue, subscribeChanges, retryDocument } from '../translator.js';

export function useDocumentLibrary(settings, onNeedSettings, onError) {
  const [documents, setDocuments] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const settingsRef = useRef(settings);
  settingsRef.current = settings;

  useEffect(() => {
    let mounted = true;
    const unsubscribe = subscribeChanges(record => {
      if (!mounted) return;
      setDocuments(previous => {
        const index = previous.findIndex(item => item.id === record.id);
        if (index < 0) return [record, ...previous];
        const next = [...previous];
        next[index] = record;
        return next;
      });
    });
    listDocuments().then(records => {
      if (!mounted) return;
      setDocuments(previous => {
        const updated = new Map(previous.map(record => [record.id, record]));
        return records.map(record => updated.get(record.id) || record);
      });
      runQueue(settingsRef.current);
    }).catch(error => onError(`读取本地论文失败：${error.message}`));
    const resume = () => runQueue(settingsRef.current);
    const resumeVisible = () => { if (!document.hidden) resume(); };
    window.addEventListener('online', resume);
    document.addEventListener('visibilitychange', resumeVisible);
    return () => {
      mounted = false;
      unsubscribe();
      window.removeEventListener('online', resume);
      document.removeEventListener('visibilitychange', resumeVisible);
    };
  }, [onError]);

  useEffect(() => { if (settings.key) runQueue(settings); }, [settings]);

  const upload = useCallback(async (file, mode = 'standard') => {
    if (!file || !/\.pdf$/i.test(file.name) || file.type && file.type !== 'application/pdf') {
      onError('请选择 PDF 文件'); return false;
    }
    if (file.size > 80 * 1024 * 1024) { onError('PDF 不能超过 80 MB'); return false; }
    try {
      const existing = await listDocuments();
      if (mode === 'standard' && existing.filter(item => !['done', 'error', 'visual'].includes(item.status)).length >= MAX_PENDING) {
        onError(`最多等待 ${MAX_PENDING} 篇论文，请稍后提交。`); return false;
      }
      const record = {
        id: crypto.randomUUID(), filename: file.name, createdAt: Date.now(),
        mode, status: mode === 'visual' ? 'visual' : 'queued', progress: 0, tokens: { prompt: 0, completion: 0, total: 0 },
        original: file, translated: null, pages: null, warnings: [], error: '',
      };
      await putDocument(record);
      setDocuments(previous => [record, ...previous]);
      setSelectedId(record.id);
      if (mode === 'visual') {
        if (!settingsRef.current.visionKey) onNeedSettings();
      } else if (settingsRef.current.key) runQueue(settingsRef.current);
      else onNeedSettings();
      return true;
    } catch (error) { onError(`本地保存失败：${error.message}`); return false; }
  }, [onError, onNeedSettings]);

  const retry = useCallback(async id => {
    try {
      await retryDocument(id, settingsRef.current);
      if (!settingsRef.current.key) onNeedSettings();
    } catch (error) { onError(`继续翻译失败：${error.message}`); }
  }, [onError, onNeedSettings]);

  return { documents, selectedId, setSelectedId, upload, retry };
}
