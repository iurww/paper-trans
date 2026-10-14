import { Alert, Button, Group, Modal, Progress, Stack, Text } from '@mantine/core';

export default function UpdateModal({ updates, lockScroll = true }) {
  const update = updates.update;
  const date = update?.date && new Date(update.date);
  return <Modal opened={Boolean(update)} onClose={updates.cancel} title="发现新版本" centered size="lg" lockScroll={lockScroll}
    closeOnClickOutside={!updates.installing} closeOnEscape={!updates.installing} withCloseButton={!updates.installing} zIndex={300}>
    <Stack gap="md">
      <Text fw={600}>PaperLens {update?.version}</Text>
      <Text size="sm" c="dimmed">当前版本：{update?.currentVersion}
        {date && !Number.isNaN(date.getTime()) ? ` · 发布时间：${date.toLocaleDateString('zh-CN')}` : ''}</Text>
      <Text size="sm" style={{ whiteSpace: 'pre-wrap', maxHeight: '40vh', overflowY: 'auto', overflowWrap: 'anywhere' }}>{update?.body || '此版本未提供更新说明。'}</Text>
      {updates.reason && <Alert color="yellow">{updates.reason}</Alert>}
      {updates.error && <Alert color="red">{updates.error}</Alert>}
      {updates.stage && <Text size="sm">{updates.stage}</Text>}
      {updates.installing && <Progress value={updates.progress || 0} animated color="teal" aria-label="更新下载进度" />}
      {updates.canInstall && !updates.installed && <Text size="xs" c="dimmed">更新完成后软件会自动重启，正在进行的翻译将从已保存进度恢复。Linux deb 安装可能请求系统管理员授权。</Text>}
      <Group justify="flex-end">
        <Button color="teal" onClick={updates.install} loading={updates.installing} disabled={!updates.canInstall}>
          {updates.installed ? '重启' : '更新'}
        </Button>
        <Button variant="default" onClick={updates.cancel} disabled={updates.installing}>取消</Button>
      </Group>
    </Stack>
  </Modal>;
}
