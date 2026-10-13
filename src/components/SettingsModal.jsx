import { useEffect, useState } from 'react';
import { Button, Modal, PasswordInput, Stack, Text, TextInput } from '@mantine/core';

export default function SettingsModal({ opened, onClose, settings, onSave, lockScroll = true }) {
  const [draft, setDraft] = useState(settings);
  useEffect(() => { if (opened) setDraft(settings); }, [opened, settings]);
  const update = (field, value) => setDraft(current => ({ ...current, [field]: value }));
  const submit = event => {
    event.preventDefault();
    onSave({ endpoint: draft.endpoint.trim(), model: draft.model.trim(), key: draft.key.trim() });
  };
  return <Modal lockScroll={lockScroll} opened={opened} onClose={onClose} title="翻译 API 设置" centered size="md" overlayProps={{ backgroundOpacity: .55 }}>
    <form onSubmit={submit}>
      <Stack gap="md">
        <Text size="sm" c="dimmed">请求从当前设备直连。密钥只保存在本机浏览器或应用存储中。</Text>
        <TextInput label="Chat Completions 地址" type="url" required value={draft.endpoint} onChange={event => update('endpoint', event.currentTarget.value)} />
        <TextInput label="模型" required value={draft.model} onChange={event => update('model', event.currentTarget.value)} />
        <PasswordInput label="API Key" value={draft.key} onChange={event => update('key', event.currentTarget.value)} autoComplete="off" />
        <Text size="xs" c="dimmed">API 服务需允许浏览器跨域请求。清除本站数据会同时删除密钥、论文与翻译记录。</Text>
        <Button type="submit" color="teal">保存</Button>
      </Stack>
    </form>
  </Modal>;
}
