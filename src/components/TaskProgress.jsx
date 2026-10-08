import { Alert, Button, Paper, Progress, Text, Title } from '@mantine/core';
import { FileText } from 'lucide-react';
import { status, tokenSummary } from '../app/format.js';

export default function TaskProgress({ document, onRetry }) {
  const failed = document.status === 'error';
  return <section className="progress-screen"><Paper className="progress-card" shadow="sm" radius="lg" withBorder>
    <span className="progress-icon"><FileText size={27} /></span>
    <Text className="eyebrow">{failed ? 'TRANSLATION STOPPED' : 'WORK IN PROGRESS'}</Text>
    <Title order={2}>{failed ? '处理遇到了问题' : '正在处理这篇论文'}</Title>
    <Text size="sm" c="dimmed" truncate>{document.filename}</Text>
    {failed ? <><Alert color="red" mt="lg">{document.error}</Alert><Button color="teal" mt="lg" onClick={onRetry}>继续翻译</Button></> : <>
      <Progress value={document.progress} color="teal" radius="xl" mt="xl" />
      <div className="progress-bottom"><span>{status(document)}</span><strong>{document.progress}%</strong></div>
      {document.status === 'retrying' && <Text size="xs" c="dimmed">API 暂时没有返回完整结果，将自动继续，无需操作。</Text>}
    </>}
    <Text size="xs" c="dimmed" mt="lg">{tokenSummary(document)}</Text>
  </Paper></section>;
}
