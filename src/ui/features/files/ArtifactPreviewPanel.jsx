import React, { useEffect, useRef, useState } from 'react';
import { ArrowLeft, Download } from 'lucide-react';
import { Highlight, themes } from 'prism-react-renderer';
import { MarkdownContent } from '../../MarkdownContent.jsx';
import { SidePanel } from '../../primitives/SidePanel.jsx';

const SOURCE_LANGUAGE_BY_EXTENSION = Object.freeze({
  c: 'c', cc: 'cpp', cpp: 'cpp', cxx: 'cpp', h: 'c', hpp: 'cpp',
  css: 'css', go: 'go', html: 'markup', htm: 'markup',
  js: 'javascript', jsx: 'jsx', json: 'json', kt: 'kotlin', kts: 'kotlin',
  md: 'markdown', markdown: 'markdown', mdown: 'markdown',
  mjs: 'javascript', cjs: 'javascript', py: 'python', rs: 'rust',
  sql: 'sql', svg: 'markup', swift: 'swift', ts: 'typescript', tsx: 'tsx',
  xml: 'markup', yaml: 'yaml', yml: 'yaml',
});

function fileExtension(name = '') {
  const base = String(name).split(/[\\/]/).pop() || '';
  const index = base.lastIndexOf('.');
  return index > -1 ? base.slice(index + 1).toLowerCase() : '';
}

function textPreviewFormat(artifact = {}) {
  const extension = fileExtension(artifact.name);
  const mediaType = String(artifact.mediaType || artifact.media_type || '').toLowerCase().split(';')[0];
  const markdown = mediaType === 'text/markdown' || ['md', 'markdown', 'mdown'].includes(extension);
  const html = mediaType === 'text/html' || ['html', 'htm'].includes(extension);
  let language = SOURCE_LANGUAGE_BY_EXTENSION[extension] || 'plain';
  if (language === 'plain') {
    if (/json/.test(mediaType)) language = 'json';
    else if (/javascript/.test(mediaType)) language = 'javascript';
    else if (/css/.test(mediaType)) language = 'css';
    else if (/(html|xml|svg)/.test(mediaType)) language = 'markup';
    else if (/ya?ml/.test(mediaType)) language = 'yaml';
    else if (/sql/.test(mediaType)) language = 'sql';
  }
  return { markdown, html, rich: markdown || html, language };
}

function CopyPreviewButton({ text }) {
  const [state, setState] = useState('idle');
  const timerRef = useRef(null);
  useEffect(() => () => clearTimeout(timerRef.current), []);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setState('done');
    } catch {
      setState('failed');
    }
    clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => setState('idle'), 1600);
  };
  return <button type="button" className="artifact-copy" onClick={copy} aria-live="polite" title="复制文件全文">{state === 'done' ? '已复制' : state === 'failed' ? '复制失败' : '复制'}</button>;
}

function SourcePreview({ text, line, language }) {
  const targetRef = useRef(null);
  const lines = String(text || '').split('\n');
  const targetLine = Number.isSafeInteger(Number(line)) && Number(line) > 0 ? Number(line) : 0;
  const targetExists = targetLine > 0 && targetLine <= lines.length;
  useEffect(() => {
    if (targetExists) targetRef.current?.scrollIntoView?.({ block: 'center' });
  }, [targetExists, targetLine, text]);
  return <>
    {targetLine > 0 && !targetExists && <p className="artifact-line-missing" role="status">目标第 {targetLine} 行超出文件范围（共 {lines.length} 行）</p>}
    <Highlight theme={themes.oneLight} code={String(text || '')} language={language || 'plain'}>
      {({ className, style, tokens, getLineProps, getTokenProps }) => <pre className={`${className} artifact-source-preview`} style={{ ...style, background: 'transparent' }}>
        {tokens.map((sourceLine, index) => {
          const number = index + 1;
          const lineProps = getLineProps({ line: sourceLine });
          const selected = number === targetLine;
          return <div {...lineProps} ref={selected ? targetRef : undefined} className={`${lineProps.className || ''} artifact-source-line${selected ? ' is-target' : ''}`} data-line={number} key={number}>
            <span className="artifact-source-line-number" aria-hidden="true">{number}</span>
            <span className="artifact-source-line-code">{sourceLine.map((token, tokenIndex) => <span {...getTokenProps({ token })} key={tokenIndex} />)}</span>
          </div>;
        })}
      </pre>}
    </Highlight>
  </>;
}

function NoPreview({ artifact, title, detail, onDownload }) {
  return <div className="artifact-no-preview">
    <strong>{title}</strong>
    <p>{detail}</p>
    {artifact && onDownload && <button type="button" className="artifact-download-action" aria-label={`下载 ${artifact.name}`} onClick={() => onDownload(artifact)}><Download size={15} aria-hidden="true" />下载原文件</button>}
  </div>;
}

function Preview({ artifact, preview, textMode, onDownload }) {
  if (!artifact) return <p>没有选择文件。</p>;
  if (preview?.status === 'loading') return <p role="status">正在加载预览…</p>;
  if (preview?.status === 'error') return <NoPreview artifact={artifact} title="预览暂不可用" detail={preview.error} onDownload={onDownload} />;
  if (preview?.status === 'unsupported') return <NoPreview artifact={artifact} title="此文件暂不支持站内预览" detail={preview.reason || '文件事实和来源仍然保留，可以安全下载后打开。'} onDownload={onDownload} />;
  if (preview?.kind === 'image' && preview.url) return <img src={preview.url} alt={artifact.name || '文件预览'} />;
  if (preview?.kind === 'video' && preview.url) return <video controls src={preview.url} />;
  if (preview?.kind === 'audio' && preview.url) return <audio controls src={preview.url} />;
  if (preview?.kind === 'pdf' && preview.url) return <object className="artifact-pdf" data={preview.url} type="application/pdf" aria-label={artifact.name || 'PDF 预览'}><NoPreview artifact={artifact} title="这个浏览器不能内嵌显示 PDF" detail="可以下载后用系统查看器打开。" onDownload={onDownload} /></object>;
  if (typeof preview?.text === 'string' && preview.status === 'ready') {
    const format = textPreviewFormat(artifact);
    if (format.markdown && textMode === 'preview') return <MarkdownContent contentKey={`artifact:${artifact.resourceId || artifact.resource_id}:preview`} text={preview.text} className="artifact-markdown-preview" />;
    if (format.html && textMode === 'preview') return <iframe className="artifact-html-preview" sandbox="" srcDoc={preview.text} title={artifact.name || 'HTML 预览'} />;
    return <div className="artifact-text-preview"><SourcePreview text={preview.text} line={artifact.line} language={format.language} /></div>;
  }
  return <div className="artifact-no-preview"><strong>尚未读取预览</strong><p>重新打开此文件即可读取内容。</p></div>;
}

export function ArtifactPreviewPanel({ port = {}, onClose }) {
  const artifact = port.selectedArtifact;
  const preview = port.preview || {};
  const format = textPreviewFormat(artifact || {});
  const targetLine = Number.isSafeInteger(Number(artifact?.line)) && Number(artifact.line) > 0 ? Number(artifact.line) : 0;
  const [textMode, setTextMode] = useState(format.rich && !targetLine ? 'preview' : 'source');
  useEffect(() => {
    setTextMode(format.rich && !targetLine ? 'preview' : 'source');
  }, [artifact?.resourceId, artifact?.resource_id, format.rich, targetLine]);
  const copyable = preview.status === 'ready' && typeof preview.text === 'string' ? preview.text : null;
  const canGoBack = port.canGoBack === true || preview.canGoBack === true;
  const back = port.commands?.back || preview.back;
  const close = () => { if (canGoBack && back) back(); else onClose?.(); };
  const headerActions = (canGoBack || format.rich || copyable !== null) ? <div className="artifact-preview-mode artifact-preview-mode-header" role="group" aria-label="文件操作">
    {canGoBack && <button type="button" className="artifact-back" aria-label="返回上一个文件" title="返回上一个文件" onClick={() => back?.()}><ArrowLeft size={15} /></button>}
    {format.rich && <>
      <button type="button" className={textMode === 'preview' ? 'active' : ''} aria-pressed={textMode === 'preview'} onClick={() => setTextMode('preview')}>预览</button>
      <button type="button" className={textMode === 'source' ? 'active' : ''} aria-pressed={textMode === 'source'} onClick={() => setTextMode('source')}>源码</button>
    </>}
    {copyable !== null && <CopyPreviewButton text={copyable} />}
  </div> : null;
  return <SidePanel className="artifact-context" ariaLabel="文件详情" title={artifact?.name || '文件预览'} closeLabel="关闭文件详情" onClose={close} headerActions={headerActions}>
    <section className="artifact-context-preview" aria-label="文件预览"><Preview artifact={artifact} preview={preview} textMode={textMode} onDownload={port.commands?.download} /></section>
  </SidePanel>;
}
