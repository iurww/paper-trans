import { useCallback, useEffect, useRef, useState } from 'react';
import { listDocuments, putDocument, listFolders, putFolder, deleteDocument, updateDocument, replaceDocument } from '../storage/storage.js';
import { openPdf } from '../pdf/pdf.js';
import { MAX_PENDING, runQueue, subscribeChanges, retryDocument } from '../translation/translator.js';

async function readMetadata(file) {
  let metadata = {};
  let pdf;
  try {
    pdf = await openPdf(new Uint8Array(await file.arrayBuffer()));
    const { info } = await pdf.getMetadata();
    metadata = { title: info.Title || '', author: info.Author || '', subject: info.Subject || '', keywords: info.Keywords || '', creator: info.Creator || '', producer: info.Producer || '', pageCount: pdf.numPages };
  } catch { /* Metadata is optional, including for encrypted PDFs. */ }
  finally { if (pdf) await pdf.loadingTask.destroy().catch(() => {}); }
  return metadata;
}

export function useDocumentLibrary(settings, onNeedSettings, onError) {
  const [removingIds, setRemovingIds] = useState([]);
  const [documents, setDocuments] = useState([]);
  const [folders, setFolders] = useState([{ id: 'default', name: 'default' }]);
  const [folderId, setFolderId] = useState(null);
  const [duplicate, setDuplicate] = useState(null);
  const uploadBusy = useRef(false);
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
    listFolders().then(setFolders).catch(error => onError(`读取目录失败：${error.message}`));
    listDocuments().then(records => {
      if (!mounted) return;
      setDocuments(previous => {
        const updated = new Map(previous.map(record => [record.id, record]));
        return records.map(record => updated.get(record.id) || record);
      });
      runQueue(settingsRef.current);
      void (async () => {
        for (const record of records.filter(item => !item.metadata)) {
          if (!mounted) break;
          const metadata = await readMetadata(record.original);
          if (!mounted) break;
          try {
            const updated = await updateDocument(record.id, current => ({ ...current, metadata }));
            if (mounted) setDocuments(previous => previous.map(item => item.id === updated.id ? updated : item));
          } catch { /* A record can be deleted while metadata is being read. */ }
        }
      })();
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

  const storeUpload = useCallback(async (file, mode, fingerprint, targetFolder, overwrite) => {
    const existing = await listDocuments();
    if (mode === 'standard' && existing.filter(item => item.id !== overwrite?.id && !['done', 'error', 'visual'].includes(item.status)).length >= MAX_PENDING) {
      onError(`最多等待 ${MAX_PENDING} 篇论文，请稍后提交。`); return false;
    }
    const metadata = await readMetadata(file);
    const record = {
      id: crypto.randomUUID(), filename: file.name, createdAt: Date.now(),
      folderId: overwrite?.folderId || targetFolder, fingerprint, metadata,
      mode, status: mode === 'visual' ? 'visual' : 'queued', progress: 0, tokens: { prompt: 0, completion: 0, total: 0 },
      original: file, translated: null, pages: null, warnings: [], error: '',
    };
    if (overwrite) await replaceDocument(overwrite.id, record);
    else await putDocument(record);
    setDocuments(previous => [record, ...previous.filter(item => item.id !== overwrite?.id)]);
    setSelectedId(record.id);
    setFolderId(record.folderId);
    if (mode === 'visual') { if (!settingsRef.current.key) onNeedSettings(); }
    else if (settingsRef.current.key) runQueue(settingsRef.current);
    else onNeedSettings();
    return true;
  }, [onError, onNeedSettings]);

  const upload = useCallback(async (file, mode = 'visual', targetFolder = folderId || 'default') => {
    if (uploadBusy.current || duplicate) return false;
    if (!file || !/\.pdf$/i.test(file.name) || file.type && file.type !== 'application/pdf') {
      onError('请选择 PDF 文件'); return false;
    }
    if (file.size > 80 * 1024 * 1024) { onError('PDF 不能超过 80 MB'); return false; }
    if (!folders.some(folder => folder.id === targetFolder)) { onError('请选择保存目录'); return false; }
    uploadBusy.current = true;
    try {
      const hash = async blob => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', await blob.arrayBuffer())), byte => byte.toString(16).padStart(2, '0')).join('');
      const fingerprint = await hash(file);
      for (const item of await listDocuments()) {
        if (item.original.size !== file.size) continue;
        const savedHash = item.fingerprint || await hash(item.original);
        if (!item.fingerprint) await updateDocument(item.id, current => ({ ...current, fingerprint: savedHash }));
        if (savedHash === fingerprint) {
          setDuplicate({ file, mode, fingerprint, folderId: targetFolder, existing: item });
          return false;
        }
      }
      return await storeUpload(file, mode, fingerprint, targetFolder);
    } catch (error) { onError(`本地保存失败：${error.message}`); return false; }
    finally { uploadBusy.current = false; }
  }, [onError, folderId, folders, duplicate, storeUpload]);

  const overwriteDuplicate = async () => {
    if (!duplicate || uploadBusy.current) return false;
    uploadBusy.current = true;
    try {
      const result = await storeUpload(duplicate.file, duplicate.mode, duplicate.fingerprint, duplicate.folderId, duplicate.existing);
      if (result) setDuplicate(null);
      return result;
    } catch (error) { onError(`覆盖失败：${error.message}`); return false; }
    finally { uploadBusy.current = false; }
  };
  const createFolder = async name => {
    name = name.trim();
    if (!name || /[\/\\]/.test(name)) { onError('请输入一级目录名称，不能包含斜杠'); return false; }
    if (folders.some(folder => folder.name === name)) { onError('目录名称已存在'); return false; }
    try {
      const folder = { id: crypto.randomUUID(), name };
      await putFolder(folder); setFolders(previous => [...previous, folder]); setFolderId(folder.id); return true;
    } catch (error) { onError(`创建目录失败：${error.message}`); return false; }
  };
  const remove = async id => {
    try {
      await deleteDocument(id);
      setRemovingIds(previous => [...previous, id]);
      if (!window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
        await new Promise(resolve => setTimeout(resolve, 280));
      }
      setDocuments(previous => previous.filter(item => item.id !== id));
      setSelectedId(current => current === id ? null : current);
      setRemovingIds(previous => previous.filter(item => item !== id));
    } catch (error) { onError(`删除失败：${error.message}`); }
  };
  const move = async (id, target) => {
    if (!folders.some(folder => folder.id === target)) return;
    try {
      const record = await updateDocument(id, current => ({ ...current, folderId: target }));
      setDocuments(previous => previous.map(item => item.id === id ? record : item));
    } catch (error) { onError(`移动失败：${error.message}`); }
  };

  const retry = useCallback(async id => {
    try {
      await retryDocument(id, settingsRef.current);
      if (!settingsRef.current.key) onNeedSettings();
    } catch (error) { onError(`继续翻译失败：${error.message}`); }
  }, [onError, onNeedSettings]);

  return { documents, removingIds, folders, folderId, setFolderId, createFolder, remove, move, duplicate, cancelDuplicate: () => setDuplicate(null), overwriteDuplicate, selectedId, setSelectedId, upload, retry };
}
