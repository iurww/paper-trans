import { memo, useState } from 'react';
import { ActionIcon, Button, Popover, Modal, Progress, Select, Text, TextInput } from '@mantine/core';
import { Download, FileText, Plus, RotateCcw, Settings, BookOpen, Folder, FolderPlus, Trash2, Info, ArrowLeft, ChevronRight } from 'lucide-react';
import { label, status, tokenKilos } from '../app/format.js';

const TaskItem = memo(function TaskItem({ document, selected, onSelect, folders, onMove, onDelete, removing = false, mobile = false }) {
  const [detailsOpen, setDetailsOpen] = useState(false);
  const visual = document.mode === 'visual';
  const donePages = (document.visualPages || []).filter(Boolean).length;
  const progress = visual ? Math.round(100 * donePages / (document.visualPageCount || 1)) : document.progress;
  const tokens = visual ? document.visualTokens : document.tokens;
  const metadata = document.metadata || {};
  const paragraphs = document.visualPages?.[0]?.paragraphs || [];
  const title = metadata.title || paragraphs.find(item => item.kind === 'title')?.original || label(document);
  const author = metadata.author || paragraphs.filter(item => item.kind === 'author').map(item => item.original).join('; ');
  const details = <div className="document-metadata">
      <strong>{title}</strong>
      <dl>{[
        ['作者', author || '未提供'], ['文件名', document.filename],
        ['目录', folders.find(folder => folder.id === (document.folderId || 'default'))?.name || 'default'],
        ['导入时间', document.createdAt ? new Date(document.createdAt).toLocaleString('zh-CN') : '未知'],
        ['文件大小', `${((document.original?.size || 0) / 1024 / 1024).toFixed(2)} MB`],
        ['页数', metadata.pageCount || document.visualPageCount || document.pages?.length || '未知'],
        ['翻译状态', status(document)], ['模式', visual ? '纯视觉识别' : '常规翻译'],
        ['Token 用量', (tokens?.total || 0).toLocaleString()],
        ['主题', metadata.subject], ['关键词', metadata.keywords],
        ['SHA-256', document.fingerprint], ['错误', document.error || document.visualError],
      ].filter(([, value]) => value).map(([key, value]) => <div key={key}><dt>{key}</dt><dd>{value}</dd></div>)}</dl>
      <Select comboboxProps={{ withinPortal: false }} size="xs" label="移动到目录" value={document.folderId || 'default'} data={folders.map(folder => ({ value: folder.id, label: folder.name }))} onChange={value => value && onMove?.(document.id, value)} />
    </div>;
  return <div className={`task-row ${removing ? 'is-removing' : ''}`} inert={removing || undefined}><div className="task-row-content"><button type="button" className={`task-item ${selected ? 'selected' : ''}`} onClick={() => onSelect(document.id)}>
    <span className="task-icon"><FileText size={17} /></span>
    <span className="task-copy">
      <strong title={document.filename}>{label(document)}</strong>
      <small>{status(document)} · {progress}%</small>
      <small>输入 {tokenKilos(tokens?.prompt)} 输出 {tokenKilos(tokens?.completion)}</small>
      {(visual ? document.visualStatus === 'working' : !['done', 'error'].includes(document.status)) && <Progress value={progress} size={3} radius="xl" color="teal" mt={5} />}
    </span>
    {(visual ? document.visualStatus === 'done' : document.status === 'done') && <span className="task-complete" />}
  </button>
    <div className="task-item-actions">
      {mobile ? <>
        <ActionIcon variant="subtle" color="teal" aria-label={`查看 ${document.filename} 详情`} aria-expanded={detailsOpen} onClick={() => setDetailsOpen(true)}><Info size={15} /></ActionIcon>
        <Modal opened={detailsOpen} onClose={() => setDetailsOpen(false)} title="文献详情" centered size="sm" lockScroll={false}>
          {details}
        </Modal>
      </> : <Popover width="min(340px, calc(100vw - 24px))" position="right-start" shadow="md" withinPortal opened={detailsOpen} onChange={setDetailsOpen}>
        <Popover.Target><ActionIcon variant="subtle" color="teal" aria-label={`查看 ${document.filename} 详情`} aria-expanded={detailsOpen} onClick={() => setDetailsOpen(current => !current)}><Info size={15} /></ActionIcon></Popover.Target>
        <Popover.Dropdown>{details}</Popover.Dropdown>
      </Popover>}
      <ActionIcon className="delete-document" variant="subtle" color="red" aria-label={`删除 ${document.filename}`} onClick={() => onDelete(document)}><Trash2 size={14} /></ActionIcon></div></div></div>;
});

export default function TaskSidebar({ documents, removingIds = [], selected, onSelect, onNew, onSettings, onDownload, onRetranslate, mobile = false, folders = [{ id: 'default', name: 'default' }], folderId = null, onFolderSelect, onCreateFolder, onMove, onDelete }) {
  const [sidebarWidth, setSidebarWidth] = useState(() => {
    const saved = Number(typeof localStorage !== 'undefined' ? localStorage.getItem('paperlens-sidebar-width') : 0);
    return saved ? Math.max(200, Math.min(520, saved)) : 246;
  });
  const resizeStart = event => {
    if (event.button !== 0) return;
    event.currentTarget.setPointerCapture(event.pointerId);
  };
  const resizeMove = event => {
    if (!event.currentTarget.hasPointerCapture(event.pointerId)) return;
    const left = event.currentTarget.parentElement.getBoundingClientRect().left;
    const width = Math.max(200, Math.min(520, window.innerWidth - 360, event.clientX - left));
    setSidebarWidth(width);
    localStorage.setItem('paperlens-sidebar-width', String(width));
  };
  const resizeEnd = event => {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  };
  const activeFolder = folders.find(folder => folder.id === folderId);
  const [folderOpen, setFolderOpen] = useState(false);
  const [folderName, setFolderName] = useState('');
  const [deleting, setDeleting] = useState(null);
  const visible = documents.filter(item => (item.folderId || 'default') === folderId);
  const legacy = selected?.status === 'done' && selected.pages?.some(page => !page.blocks);
  return <aside className={`task-sidebar ${mobile ? 'task-sidebar-mobile' : ''}`} aria-label="任务列表" style={mobile ? undefined : { '--sidebar-width': `${sidebarWidth}px` }}>
    <div className="brand"><span className="brand-mark"><BookOpen size={20} /></span><span>PaperLens<small>论文翻译工作台</small></span></div>
    <div className="sidebar-create-actions">
      <Button leftSection={<Plus size={16} />} onClick={onNew} color="teal">新建翻译</Button>
      <Button leftSection={<FolderPlus size={16} />} onClick={() => { setFolderName(''); setFolderOpen(true); }} color="teal">新建目录</Button>
    </div>
    <div className="sidebar-heading">
      {activeFolder ? <><ActionIcon variant="subtle" color="teal" aria-label="返回目录列表" onClick={() => onFolderSelect?.(null)}><ArrowLeft size={16} /></ActionIcon><strong title={activeFolder.name}>{activeFolder.name}</strong><span>{visible.length}</span></> : <>我的目录 <span>{folders.length}</span></>}
    </div>
    <div className="task-list">
      {activeFolder ? (visible.length ? visible.map(document => <TaskItem key={document.id} document={document} selected={selected?.id === document.id} onSelect={onSelect} folders={folders} onMove={onMove} onDelete={setDeleting} removing={removingIds.includes(document.id)} mobile={mobile} />)
        : <Text size="xs" c="dimmed" px="md" py="sm">此目录暂无文献。</Text>) : <>
        {folders.map(folder => <button type="button" key={folder.id} className="folder-item" onClick={() => onFolderSelect?.(folder.id)}><Folder size={17} /><span>{folder.name}</span><small>{documents.filter(item => (item.folderId || 'default') === folder.id).length}</small><ChevronRight size={14} /></button>)}
      </>}
    </div>
    <div className="sidebar-actions">
      {selected?.translated && <>
        {legacy && <Button variant="subtle" color="teal" leftSection={<RotateCcw size={16} />} onClick={onRetranslate} title="重新调用翻译 API，会产生新的 Token 用量">按句重译</Button>}
        <Button variant="subtle" color="teal" leftSection={<Download size={16} />} onClick={onDownload}>下载译文 PDF</Button>
      </>}
      <Button variant="subtle" color="gray" leftSection={<Settings size={16} />} onClick={onSettings}>API 设置</Button>
      <Text size="xs" c="dimmed">所有文件和记录只保存在本机</Text>
    </div>
    {!mobile && <div className="sidebar-resize-handle" role="separator" aria-label="调整侧边栏宽度" aria-orientation="vertical" aria-valuemin={200} aria-valuemax={520} aria-valuenow={sidebarWidth} tabIndex={0}
      onPointerDown={resizeStart} onPointerMove={resizeMove} onPointerUp={resizeEnd} onPointerCancel={resizeEnd}
      onKeyDown={event => { if (!['ArrowLeft', 'ArrowRight'].includes(event.key)) return; event.preventDefault(); const width = Math.max(200, Math.min(520, sidebarWidth + (event.key === 'ArrowRight' ? 10 : -10))); setSidebarWidth(width); localStorage.setItem('paperlens-sidebar-width', String(width)); }} />}
    <Modal opened={folderOpen} onClose={() => setFolderOpen(false)} title="新建一级目录" centered size="sm">
      <form onSubmit={async event => { event.preventDefault(); if (await onCreateFolder?.(folderName)) setFolderOpen(false); }}><TextInput autoFocus label="目录名称" maxLength={80} value={folderName} onChange={event => setFolderName(event.target.value)} /><Button type="submit" color="teal" fullWidth mt="md">创建目录</Button></form>
    </Modal>
    <Modal opened={Boolean(deleting)} onClose={() => setDeleting(null)} title="删除文献" centered size="sm">
      <Text size="sm">删除「{deleting?.filename}」及其全部本地翻译记录？</Text>
      <Button color="red" fullWidth mt="md" onClick={() => { const id = deleting.id; setDeleting(null); void onDelete?.(id); }}>删除</Button>
    </Modal>
  </aside>;
}
