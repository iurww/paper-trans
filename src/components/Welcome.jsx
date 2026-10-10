import { Button, Text, Title } from '@mantine/core';
import { Plus } from 'lucide-react';

export default function Welcome({ onUpload, mode = 'visual' }) {
  return <section className="welcome">
    <div className="welcome-deco" aria-hidden="true"><span className="deco-page back" /><span className="deco-page front"><i /><i /><i /><i /><i /></span><span className="deco-spark">✦</span></div>
    <Text className="eyebrow">READ WITHOUT BORDERS</Text>
    <Title order={1}>每一篇好论文，<br /><em>都值得被读懂。</em></Title>
    <Text size="sm" c="dimmed">提供自己的翻译 API，在本机完成处理并保存译文。</Text>
    <Button color="teal" leftSection={<Plus size={17} />} onClick={onUpload} mt="xl">上传论文 PDF</Button>
    <Text size="xs" c="dimmed" mt="sm">{mode === 'visual' ? '支持扫描版 PDF · 按页发送截图至 DeepSeek' : '支持可提取文字的 PDF'} · 最高 80 MB</Text>
    <div className="welcome-features">
      <div><span>01</span><strong>原貌呈现</strong><small>图、表、公式与参考文献保持原样</small></div>
      <div><span>02</span><strong>清晰对照</strong><small>双侧整篇滚动，按屏幕分辨率渲染</small></div>
      <div><span>03</span><strong>本地保存</strong><small>论文、译文和进度保存在当前设备</small></div>
    </div>
  </section>;
}
