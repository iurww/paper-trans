import { Alert, Button } from '@mantine/core';
import { alignmentProblemMessage } from '../alignment-problems.js';

export default function AlignmentProblems({ problems, error, disabled, onJump, onRetry, onDownload }) {
  return <Alert color="orange" className="vision-error">
    句级对照：{problems.length ? alignmentProblemMessage(problems) : error}
    {problems.length > 0 && error && !error.includes('缺少有效句级对照') && <p>{error}</p>}
    <Button ml="sm" size="compact-sm" variant="white" disabled={disabled} onClick={() => onRetry()}>重试未对齐页</Button>
    {problems.length > 0 && <>
      <Button ml="sm" size="compact-sm" variant="white" onClick={onDownload}>下载未对齐诊断 JSON</Button>
      <div className="alignment-problems">{problems.map(page => <div key={page.number} className="alignment-problem">
        <Button size="compact-xs" variant="light" color="teal" aria-label={`跳转到第 ${page.number} 页译文`}
          onClick={() => onJump(page.number)}>PDF 第 {page.number} 页</Button>
        <span>未完成段落：{page.paragraphs.map(item => item.paragraph + 1).join('、')}</span>
        <Button size="compact-xs" variant="white" disabled={disabled} onClick={() => onRetry(page.number)}>重试第 {page.number} 页对齐</Button>
        <details><summary>查看第 {page.number} 页失败原因和文本</summary>
          <p>{page.reason}</p>
          {page.paragraphs.map(item => <div key={item.paragraph}>
            <strong>第 {item.paragraph + 1} 段</strong>
            <p lang="en">{item.original}</p><p lang="zh">{item.chinese}</p>
          </div>)}
        </details>
      </div>)}</div>
    </>}
  </Alert>;
}
