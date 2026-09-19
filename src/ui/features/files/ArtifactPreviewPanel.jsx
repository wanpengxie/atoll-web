import React from 'react';
import { Download } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import rehypeKatex from 'rehype-katex';
import remarkBreaks from 'remark-breaks';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import { SidePanel } from '../../primitives/SidePanel.jsx';

function Preview({ artifact, preview }) {
  if (!artifact) return <p>没有选择文件。</p>;
  if (preview?.status === 'loading') return <p role="status">正在读取预览…</p>;
  if (preview?.status === 'error') return <div className="artifact-no-preview" role="alert"><strong>无法预览</strong><p>{preview.error}</p></div>;
  if (preview?.status === 'unsupported') return <div className="artifact-no-preview"><strong>不支持此媒体类型</strong><p>{preview.reason || `${preview.mediaType || '未知媒体类型'} 文件请下载后打开。`}</p></div>;
  if (preview?.kind === 'image' && preview.url) return <img src={preview.url} alt={artifact.name || '文件预览'} />;
  if (preview?.kind === 'video' && preview.url) return <video controls src={preview.url} />;
  if (preview?.kind === 'audio' && preview.url) return <audio controls src={preview.url} />;
  if (preview?.kind === 'pdf' && preview.url) return <iframe title={artifact.name || 'PDF 预览'} src={preview.url} />;
  if (preview?.kind === 'markdown') return <div className="artifact-markdown-preview"><ReactMarkdown remarkPlugins={[remarkGfm, remarkBreaks, remarkMath]} rehypePlugins={[rehypeKatex]}>{preview.text || ''}</ReactMarkdown></div>;
  if (typeof preview?.text === 'string') return <pre className="artifact-source-preview">{preview.text}</pre>;
  return <div className="artifact-no-preview"><strong>尚未读取预览</strong><p>重新打开此文件即可读取内容。</p></div>;
}

export function ArtifactPreviewPanel({ port = {}, onClose }) {
  const artifact = port.selectedArtifact;
  const close = () => {
    port.commands?.select?.(null);
    onClose?.();
  };
  return <SidePanel className="artifact-context" ariaLabel="文件预览" eyebrow="FILE" title={artifact?.name || '文件预览'} onClose={close} headerActions={artifact && <button type="button" className="artifact-download-action" onClick={() => port.commands?.download?.(artifact)}><Download size={14} />下载</button>}>
    <div className="artifact-context-preview"><Preview artifact={artifact} preview={port.preview} /></div>
  </SidePanel>;
}
