import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActionIcon, Alert, Button, Drawer, Modal, SegmentedControl, Select, Text } from '@mantine/core';
import { FileText, PanelLeftClose, PanelLeftOpen, Settings } from 'lucide-react';
import { resumeConfigurationErrors } from '../translation/translator.js';
import { downloadTranslation, label } from './format.js';
import { isAndroid } from '../platform/desktop.js';
import { hasModeResult } from './mode.js';
import { loadSettings, saveSettings, SIDEBAR_KEY } from './settings.js';
import { useDocumentLibrary } from './useDocumentLibrary.js';
import TaskSidebar from '../components/TaskSidebar.jsx';
import SettingsModal from '../components/SettingsModal.jsx';
import Welcome from '../components/Welcome.jsx';
import TaskProgress from '../components/TaskProgress.jsx';
import Reader from '../reader/Reader.jsx';
import { useAppUpdates } from './useAppUpdates.js';
import UpdateModal from '../components/UpdateModal.jsx';

export default function App() {
  const android = isAndroid();
  const updates = useAppUpdates();
  const [settings, setSettings] = useState(loadSettings);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [uploadFolderId, setUploadFolderId] = useState(null);
  const [uploadMode, setUploadMode] = useState('visual');
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => localStorage.getItem(SIDEBAR_KEY) === 'true');
  const [notice, setNotice] = useState('');
  const [mode, setMode] = useState('visual');
  const fileInput = useRef(null);
  const showError = useCallback(message => setNotice(message), []);
  const openSettings = useCallback(() => { setDrawerOpen(false); setSettingsOpen(true); }, []);
  const openTasks = useCallback(() => setDrawerOpen(true), []);
  const library = useDocumentLibrary(settings, openSettings, showError);
  const selected = useMemo(() => library.documents.find(item => item.id === library.selectedId) || null,
    [library.documents, library.selectedId]);
  const reading = Boolean(selected && (mode === 'visual' || hasModeResult(selected, 'standard')));

  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(''), 5000);
    return () => clearTimeout(timer);
  }, [notice]);

  const toggleSidebar = useCallback(() => setSidebarCollapsed(current => {
    localStorage.setItem(SIDEBAR_KEY, String(!current));
    return !current;
  }), []);
  const chooseFile = useCallback(() => { setDrawerOpen(false); setUploadMode(android ? 'visual' : mode); setUploadFolderId(library.folderId); setUploadOpen(true); }, [android, mode, library.folderId]);
  const selectDocument = useCallback(id => {
    const record = library.documents.find(item => item.id === id);
    setMode(android ? 'visual' : record?.mode || (record?.translated ? 'standard' : 'visual'));
    library.setSelectedId(id); setDrawerOpen(false);
  }, [android, library.documents, library.setSelectedId]);
  const changeMode = useCallback(value => {
    if (selected && value !== mode) {
      const available = hasModeResult(selected, value);
      if (!available) { setNotice(value === 'standard' ? '这篇论文还没有常规模式译文，无法切换' : '这篇论文还没有完整的视觉识别译文，无法切换'); return; }
    }
    setMode(value);
  }, [mode, selected]);
  const download = useCallback(async () => {
    try { await downloadTranslation(selected); }
    catch (error) { setNotice(`保存译文失败：${error.message || error}`); }
  }, [selected]);
  const retranslate = useCallback(() => { if (selected) library.retry(selected.id); setDrawerOpen(false); }, [library.retry, selected]);
  const retry = useCallback(() => { if (selected) library.retry(selected.id); }, [library.retry, selected]);
  const handleSettingsSave = useCallback(next => {
    saveSettings(next);
    setSettings(next);
    setSettingsOpen(false);
    resumeConfigurationErrors(next);
  }, []);

  const sidebarProps = {
    documents: library.documents, removingIds: library.removingIds, selected, onSelect: selectDocument, onNew: chooseFile,
    folders: library.folders, folderId: library.folderId, onFolderSelect: library.setFolderId,
    onCreateFolder: library.createFolder, onMove: library.move, onDelete: library.remove,
    onSettings: openSettings, onDownload: download, onRetranslate: retranslate,
  };

  return <div className={`app-layout ${reading ? 'is-reading' : ''} ${sidebarCollapsed ? 'sidebar-collapsed' : ''}`}>
    <TaskSidebar {...sidebarProps} />
    <main className="app-main">
      {reading ? <Reader translatedOnly={android} key={selected.id} document={selected} settings={settings} mode={mode} onModeChange={changeMode} sidebarCollapsed={sidebarCollapsed}
        onToggleSidebar={toggleSidebar} onOpenTasks={openTasks} overlayOpen={settingsOpen || drawerOpen || uploadOpen || Boolean(library.duplicate) || Boolean(updates.update)} /> : <>
        <header className="regular-toolbar">
          <ActionIcon className="desktop-sidebar-toggle" variant="subtle" color="teal" aria-label={sidebarCollapsed ? '展开任务列表' : '折叠任务列表'} onClick={toggleSidebar}>
            {sidebarCollapsed ? <PanelLeftOpen size={18} /> : <PanelLeftClose size={18} />}
          </ActionIcon>
          <span className="mobile-brand">PaperLens</span>
          <span className="breadcrumb">工作台 <i>/</i> {selected ? label(selected) : '欢迎使用'}</span>
          {!android && <SegmentedControl className="regular-mode-switch" size="xs" color="teal" value={mode} onChange={changeMode}
            data={[{ label: '常规', value: 'standard' }, { label: '纯视觉识别', value: 'visual' }]} />}
          <div className="mobile-actions">
            <ActionIcon variant="subtle" color="teal" aria-label="我的文献" onClick={openTasks}><FileText size={18} /></ActionIcon>
            <ActionIcon variant="subtle" color="teal" aria-label="API 设置" onClick={openSettings}><Settings size={18} /></ActionIcon>
          </div>
        </header>
        {selected ? <TaskProgress document={selected} onRetry={retry} /> : <Welcome onUpload={chooseFile} mode={mode} />}
      </>}
    </main>
    <input ref={fileInput} type="file" accept="application/pdf,.pdf" hidden onChange={async event => {
      const file = event.currentTarget.files?.[0];
      event.currentTarget.value = '';
      if (file && await library.upload(file, uploadMode, uploadFolderId)) setMode(uploadMode);
    }} />
    {/* Reading panes own scrolling; locking body forces WebKit to relayout the entire paper. */}
    <Drawer lockScroll={!reading} opened={drawerOpen} onClose={() => setDrawerOpen(false)} position="right" size="min(360px, 88vw)" title="我的文献"
      styles={{ body: { padding: 0, height: 'calc(100% - 60px)' } }}>
      <TaskSidebar {...sidebarProps} mobile />
    </Drawer>
    <Modal lockScroll={!reading} opened={uploadOpen} onClose={() => setUploadOpen(false)} title="新建翻译" centered size="sm">
      <Select label="保存目录" placeholder="请选择目录" required allowDeselect={false} value={uploadFolderId} onChange={setUploadFolderId}
        data={library.folders.map(folder => ({ value: folder.id, label: folder.name }))} mb="md" />
      {!android && <SegmentedControl value={uploadMode} onChange={setUploadMode} fullWidth color="teal"
        data={[{ label: '常规翻译', value: 'standard' }, { label: '纯视觉识别', value: 'visual' }]} />}
      <Button fullWidth color="teal" mt="lg" disabled={!uploadFolderId} onClick={() => { setUploadOpen(false); fileInput.current?.click(); }}>选择 PDF</Button>
    </Modal>
    <Modal lockScroll={!reading} opened={Boolean(library.duplicate)} onClose={library.cancelDuplicate} title="这篇论文已存在" centered size="sm">
      <Text size="sm">上传的 PDF 与「{library.duplicate?.existing.filename}」内容完全相同。覆盖会清除已有译文和识别记录，并按所选模式重新开始。</Text>
      <Button fullWidth color="teal" mt="lg" onClick={async () => { const nextMode = library.duplicate.mode; if (await library.overwriteDuplicate()) setMode(nextMode); }}>覆盖并重新翻译</Button>
      <Button fullWidth variant="default" mt="sm" onClick={library.cancelDuplicate}>取消</Button>
    </Modal>
    <SettingsModal lockScroll={!reading} opened={settingsOpen} onClose={() => setSettingsOpen(false)} settings={settings} onSave={handleSettingsSave} updates={updates} />
    <UpdateModal lockScroll={!reading} updates={updates} />
    {notice && <div className="notice"><Alert color="red" variant="filled">{notice}</Alert></div>}
  </div>;
}
