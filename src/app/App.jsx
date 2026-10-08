import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActionIcon, Alert, Drawer } from '@mantine/core';
import { FileText, PanelLeftClose, PanelLeftOpen, Settings } from 'lucide-react';
import { resumeConfigurationErrors } from '../translator.js';
import { downloadTranslation, label } from './format.js';
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
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => localStorage.getItem(SIDEBAR_KEY) === 'true');
  const [notice, setNotice] = useState('');
  const fileInput = useRef(null);
  const showError = useCallback(message => setNotice(message), []);
  const openSettings = useCallback(() => { setDrawerOpen(false); setSettingsOpen(true); }, []);
  const openTasks = useCallback(() => setDrawerOpen(true), []);
  const library = useDocumentLibrary(settings, openSettings, showError);
  const selected = useMemo(() => library.documents.find(item => item.id === library.selectedId) || null,
    [library.documents, library.selectedId]);
  const reading = selected?.status === 'done' && Boolean(selected.pages);

  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(''), 5000);
    return () => clearTimeout(timer);
  }, [notice]);

  const toggleSidebar = useCallback(() => setSidebarCollapsed(current => {
    localStorage.setItem(SIDEBAR_KEY, String(!current));
    return !current;
  }), []);
  const chooseFile = useCallback(() => fileInput.current?.click(), []);
  const selectDocument = useCallback(id => { library.setSelectedId(id); setDrawerOpen(false); }, [library.setSelectedId]);
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
      {reading ? <Reader key={selected.id} document={selected} sidebarCollapsed={sidebarCollapsed}
        onToggleSidebar={toggleSidebar} onOpenTasks={openTasks} overlayOpen={settingsOpen || drawerOpen} /> : <>
        <header className="regular-toolbar">
          <ActionIcon className="desktop-sidebar-toggle" variant="subtle" color="teal" aria-label={sidebarCollapsed ? '展开任务列表' : '折叠任务列表'} onClick={toggleSidebar}>
            {sidebarCollapsed ? <PanelLeftOpen size={18} /> : <PanelLeftClose size={18} />}
          </ActionIcon>
          <span className="mobile-brand">PaperLens</span>
          <span className="breadcrumb">工作台 <i>/</i> {selected ? label(selected) : '欢迎使用'}</span>
          <div className="mobile-actions">
            <ActionIcon variant="subtle" color="teal" aria-label="我的文献" onClick={openTasks}><FileText size={18} /></ActionIcon>
            <ActionIcon variant="subtle" color="teal" aria-label="API 设置" onClick={openSettings}><Settings size={18} /></ActionIcon>
          </div>
        </header>
        {selected ? <TaskProgress document={selected} onRetry={retry} /> : <Welcome onUpload={chooseFile} />}
      </>}
    </main>
    <input ref={fileInput} type="file" accept="application/pdf,.pdf" hidden onChange={event => {
      const file = event.currentTarget.files?.[0];
      event.currentTarget.value = '';
      if (file) library.upload(file);
    }} />
    <Drawer opened={drawerOpen} onClose={() => setDrawerOpen(false)} position="right" size="min(360px, 88vw)" title="我的文献"
      styles={{ body: { padding: 0, height: 'calc(100% - 60px)' } }}>
      <TaskSidebar {...sidebarProps} mobile />
    </Drawer>
    <SettingsModal opened={settingsOpen} onClose={() => setSettingsOpen(false)} settings={settings} onSave={handleSettingsSave} />
    {notice && <div className="notice"><Alert color="red" variant="filled">{notice}</Alert></div>}
  </div>;
}
