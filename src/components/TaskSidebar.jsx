import { memo } from 'react';
import { Button, Progress, Text } from '@mantine/core';
import { Download, FileText, Plus, RotateCcw, Settings, BookOpen } from 'lucide-react';
import { label, status, tokenCount } from '../app/format.js';

const TaskItem = memo(function TaskItem({ document, selected, onSelect }) {
  return <button type="button" className={`task-item ${selected ? 'selected' : ''}`} onClick={() => onSelect(document.id)}>
    <span className="task-icon"><FileText size={17} /></span>
    <span className="task-copy">
      <strong title={document.filename}>{label(document)}</strong>
      <small>{status(document)} · {document.progress}% · {tokenCount(document.tokens?.total)} token</small>
      {selected && <small>输入 {tokenCount(document.tokens?.prompt)} · 输出 {tokenCount(document.tokens?.completion)}</small>}
      {!['done', 'error'].includes(document.status) && <Progress value={document.progress} size={3} radius="xl" color="teal" mt={5} />}
    </span>
    {document.status === 'done' && <span className="task-complete" />}
  </button>;
});

export default function TaskSidebar({ documents, selected, onSelect, onNew, onSettings, onDownload, onRetranslate, mobile = false }) {
  const legacy = selected?.status === 'done' && selected.pages?.some(page => !page.blocks);
  return <aside className={`task-sidebar ${mobile ? 'task-sidebar-mobile' : ''}`} aria-label="任务列表">
    <div className="brand"><span className="brand-mark"><BookOpen size={20} /></span><span>PaperLens<small>论文翻译工作台</small></span></div>
    <Button leftSection={<Plus size={16} />} onClick={onNew} color="teal" className="new-task">新建翻译</Button>
    <div className="sidebar-heading">我的文献 <span>{documents.length}</span></div>
    <div className="task-list">
      {documents.length ? documents.map(document => <TaskItem key={document.id} document={document} selected={selected?.id === document.id} onSelect={onSelect} />)
        : <Text size="xs" c="dimmed" px="md" py="sm">论文和翻译记录只保存在本机。</Text>}
    </div>
    <div className="sidebar-actions">
      {selected?.status === 'done' && <>
        {legacy && <Button variant="subtle" color="teal" leftSection={<RotateCcw size={16} />} onClick={onRetranslate} title="重新调用翻译 API，会产生新的 Token 用量">按句重译</Button>}
        <Button variant="subtle" color="teal" leftSection={<Download size={16} />} onClick={onDownload}>下载译文 PDF</Button>
      </>}
      <Button variant="subtle" color="gray" leftSection={<Settings size={16} />} onClick={onSettings}>API 设置</Button>
      <Text size="xs" c="dimmed">所有文件和记录只保存在本机</Text>
    </div>
  </aside>;
}
