import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActionIcon, Alert, Button, Drawer, Modal, SegmentedControl } from '@mantine/core';
import { FileText, PanelLeftClose, PanelLeftOpen, Settings } from 'lucide-react';
import { resumeConfigurationErrors } from '../translation/translator.js';
import { downloadTranslation, label } from './format.js';
import { hasModeResult } from './mode.js';
import { loadSettings, saveSettings, SIDEBAR_KEY } from './settings.js';
import { useDocumentLibrary } from './useDocumentLibrary.js';
import TaskSidebar from '../components/TaskSidebar.jsx';
import SettingsModal from '../components/SettingsModal.jsx';
import Welcome from '../components/Welcome.jsx';
import TaskProgress from '../components/TaskProgress.jsx';
import Reader from '../reader/Reader.jsx';

export default function App() {
  const [settings, setSettings] = useState(loadSettings);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [uploadOpen, setUploadOpen] = useState(false);
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
  const chooseFile = useCallback(() => { setDrawerOpen(false); setUploadMode(mode); setUploadOpen(true); }, [mode]);
  const selectDocument = useCallback(id => {
    const record = library.documents.find(item => item.id === id);
    setMode(record?.mode || (record?.translated ? 'standard' : 'visual'));
    library.setSelectedId(id); setDrawerOpen(false);
  }, [library.documents, library.setSelectedId]);
  const changeMode = useCallback(value => {
    if (selected && value !== mode) {
      const available = hasModeResult(selected, value);
      if (!available) { setNotice(value === 'standard' ? '这篇论文还没有常规模式译文，无法切换' : '这篇论文还没有完整的视觉识别译文，无法切换'); return; }
    }
    setMode(value);
  }, [mode, selected]);
  const download = useCallback(() => downloadTranslation(selected), [selected]);
  const retranslate = useCallback(() => { if (selected) library.retry(selected.id); setDrawerOpen(false); }, [library.retry, selected]);
  const retry = useCallback(() => { if (selected) library.retry(selected.id); }, [library.retry, selected]);
  const handleSettingsSave = useCallback(next => {
    saveSettings(next);
    setSettings(next);
    setSettingsOpen(false);
    resumeConfigurationErrors(next);
  }, []);

  const sidebarProps = {
    documents: library.documents, selected, onSelect: selectDocument, onNew: chooseFile,
    onSettings: openSettings, onDownload: download, onRetranslate: retranslate,
  };

  return <div className={`app-layout ${reading ? 'is-reading' : ''} ${sidebarCollapsed ? 'sidebar-collapsed' : ''}`}>
    <TaskSidebar {...sidebarProps} />
    <main className="app-main">
      {reading ? <Reader key={selected.id} document={selected} settings={settings} mode={mode} onModeChange={changeMode} sidebarCollapsed={sidebarCollapsed}
        onToggleSidebar={toggleSidebar} onOpenTasks={openTasks} overlayOpen={settingsOpen || drawerOpen || uploadOpen} /> : <>
        <header className="regular-toolbar">
          <ActionIcon className="desktop-sidebar-toggle" variant="subtle" color="teal" aria-label={sidebarCollapsed ? '展开任务列表' : '折叠任务列表'} onClick={toggleSidebar}>
            {sidebarCollapsed ? <PanelLeftOpen size={18} /> : <PanelLeftClose size={18} />}
          </ActionIcon>
          <span className="mobile-brand">PaperLens</span>
          <span className="breadcrumb">工作台 <i>/</i> {selected ? label(selected) : '欢迎使用'}</span>
          <SegmentedControl className="regular-mode-switch" size="xs" color="teal" value={mode} onChange={changeMode}
            data={[{ label: '常规', value: 'standard' }, { label: '纯视觉识别', value: 'visual' }]} />
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
      if (file && await library.upload(file, uploadMode)) setMode(uploadMode);
    }} />
    <Drawer opened={drawerOpen} onClose={() => setDrawerOpen(false)} position="right" size="min(360px, 88vw)" title="我的文献"
      styles={{ body: { padding: 0, height: 'calc(100% - 60px)' } }}>
      <TaskSidebar {...sidebarProps} mobile />
    </Drawer>
    <Modal opened={uploadOpen} onClose={() => setUploadOpen(false)} title="选择翻译模式" centered size="sm">
      <SegmentedControl value={uploadMode} onChange={setUploadMode} fullWidth color="teal"
        data={[{ label: '常规翻译', value: 'standard' }, { label: '纯视觉识别', value: 'visual' }]} />
      <Button fullWidth color="teal" mt="lg" onClick={() => { setUploadOpen(false); fileInput.current?.click(); }}>选择 PDF</Button>
    </Modal>
    <SettingsModal opened={settingsOpen} onClose={() => setSettingsOpen(false)} settings={settings} onSave={handleSettingsSave} />
    {notice && <div className="notice"><Alert color="red" variant="filled">{notice}</Alert></div>}
  </div>;
}
