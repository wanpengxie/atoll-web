import React, { useEffect, useRef, useState } from 'react';
import { Highlight, themes } from 'prism-react-renderer';
import { formatArtifactSize } from '../../model/artifacts.js';
import { fileTransferURL } from '../../model/channel-file-transfer.js';
import { readFileTicket } from '../../model/resources.js';
import { MarkdownContent } from '../MarkdownContent.jsx';
import { SidePanel } from '../primitives/SidePanel.jsx';


export const PREVIEW_LIMITS = Object.freeze({
  text: 512 * 1024,
  image: 20 * 1024 * 1024,
  media: 50 * 1024 * 1024,
  inline: 25 * 1024 * 1024,
});

function previewLimit(kind) {
  return PREVIEW_LIMITS[kind] || 0;
}

function sizeError(limit) {
  return `文件超过站内预览上限（${formatArtifactSize(limit)}），请下载后打开。`;
}

export async function readBoundedText(response, limit = PREVIEW_LIMITS.text, signal) {
  const declared = Number(response.headers?.get?.('content-length') || 0);
  if (declared > limit) throw new RangeError(sizeError(limit));
  if (!response.body?.getReader) {
    const value = await response.text();
    if (new TextEncoder().encode(value).byteLength > limit) throw new RangeError(sizeError(limit));
    return value;
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let bytes = 0;
  let text = '';
  try {
    while (true) {
      if (signal?.aborted) throw new DOMException('预览已取消', 'AbortError');
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > limit) {
        await reader.cancel();
        throw new RangeError(sizeError(limit));
      }
      text += decoder.decode(value, { stream: true });
    }
    return text + decoder.decode();
  } finally {
    reader.releaseLock?.();
  }
}

export function useArtifactPreview(artifact, onResource) {
  const [preview, setPreview] = useState({ phase: 'idle', url: '', text: '', error: '' });
  useEffect(() => {
    let alive = true;
    let objectURL = '';
    const controller = new AbortController();
    setPreview({ phase: 'idle', url: '', text: '', error: '' });
    if (!artifact || !['text', 'image', 'media', 'inline'].includes(artifact.preview)) return () => controller.abort();
    const limit = previewLimit(artifact.preview);
    if (Number.isFinite(artifact.size) && artifact.size > limit) {
      setPreview({ phase: 'error', url: '', text: '', error: sizeError(limit) });
      return () => controller.abort();
    }
    setPreview({ phase: 'loading', url: '', text: '', error: '' });
    onResource(readFileTicket({ channelId: artifact.channelId, resourceId: artifact.resourceId })).then(async (receipt) => {
      if (!alive) return;
      // 只需要票。地址是调用方自己带来的（消息里存的就是路径），回执不必再说一遍。
      if (!receipt?.ticket) throw new TypeError('服务端没有返回可读凭据');
      const response = await fetch(fileTransferURL(artifact.channelId, receipt.ticket), { credentials: 'include', signal: controller.signal });
      if (!response.ok) throw new TypeError(`预览读取失败 (${response.status})`);
      const declared = Number(response.headers?.get?.('content-length') || 0);
      if (declared > limit) throw new RangeError(sizeError(limit));
      if (artifact.preview === 'text') {
        const value = await readBoundedText(response, limit, controller.signal);
        if (alive) setPreview({ phase: 'ready', text: value, url: '', error: '' });
      } else {
        const blob = await response.blob();
        if (blob.size > limit) throw new RangeError(sizeError(limit));
        objectURL = URL.createObjectURL(blob);
        if (!alive) URL.revokeObjectURL(objectURL);
        else setPreview({ phase: 'ready', url: objectURL, text: '', error: '' });
      }
    }).catch((error) => { if (alive && error?.name !== 'AbortError') setPreview({ phase: 'error', url: '', text: '', error: error.message || String(error) }); });
    return () => { alive = false; controller.abort(); if (objectURL) URL.revokeObjectURL(objectURL); };
  }, [artifact, onResource]);
  return preview;
}

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

export function textPreviewFormat(artifact = {}) {
  const extension = fileExtension(artifact.name);
  const mediaType = String(artifact.mediaType || '').toLowerCase().split(';')[0];
  const markdown = mediaType === 'text/markdown' || ['md', 'markdown', 'mdown'].includes(extension);
  let language = SOURCE_LANGUAGE_BY_EXTENSION[extension] || 'plain';
  if (language === 'plain') {
    if (/json/.test(mediaType)) language = 'json';
    else if (/javascript/.test(mediaType)) language = 'javascript';
    else if (/css/.test(mediaType)) language = 'css';
    else if (/(html|xml|svg)/.test(mediaType)) language = 'markup';
    else if (/ya?ml/.test(mediaType)) language = 'yaml';
    else if (/sql/.test(mediaType)) language = 'sql';
  }
  return { markdown, language };
}

function SourceArtifactPreview({ text, line, language }) {
  const targetRef = useRef(null);
  const lines = String(text || '').split('\n');
  const targetLine = Number.isSafeInteger(line) && line > 0 ? line : 0;
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

function TextArtifactPreview({ artifact, text, mode: controlledMode, onModeChange, showModeControls = true }) {
  const { markdown, language } = textPreviewFormat(artifact);
  const targetLine = Number.isSafeInteger(artifact.line) && artifact.line > 0 ? artifact.line : 0;
  const [localMode, setLocalMode] = useState(markdown && !targetLine ? 'preview' : 'source');
  const mode = controlledMode || localMode;
  const changeMode = (nextMode) => {
    setLocalMode(nextMode);
    onModeChange?.(nextMode);
  };
  useEffect(() => {
    setLocalMode(markdown && !targetLine ? 'preview' : 'source');
  }, [artifact.resourceId, markdown, targetLine]);
  return <div className="artifact-text-preview">
    {markdown && showModeControls && <div className="artifact-preview-mode" role="group" aria-label="Markdown 查看方式">
      <button type="button" className={mode === 'preview' ? 'active' : ''} aria-pressed={mode === 'preview'} onClick={() => changeMode('preview')}>预览</button>
      <button type="button" className={mode === 'source' ? 'active' : ''} aria-pressed={mode === 'source'} onClick={() => changeMode('source')}>源码</button>
    </div>}
    {markdown && mode === 'preview'
      ? <MarkdownContent text={text} className="artifact-markdown-preview" />
      : <SourceArtifactPreview text={text} line={targetLine} language={language} />}
  </div>;
}

export function ArtifactPreviewBody({ artifact, preview, textMode, onTextModeChange, showTextModeControls = true }) {
  if (!artifact) return null;
  return <>
    {preview.phase === 'loading' && <p>正在加载预览…</p>}
    {preview.phase === 'ready' && artifact.preview === 'text' && <TextArtifactPreview artifact={artifact} text={preview.text} mode={textMode} onModeChange={onTextModeChange} showModeControls={showTextModeControls} />}
    {preview.phase === 'ready' && artifact.preview === 'image' && <img src={preview.url} alt={artifact.name} />}
    {preview.phase === 'ready' && artifact.preview === 'media' && (artifact.kind === 'audio' ? <audio src={preview.url} controls /> : <video src={preview.url} controls />)}
    {preview.phase === 'ready' && artifact.preview === 'inline' && <iframe src={preview.url} title={artifact.name} />}
    {(artifact.preview === 'download_only' || artifact.preview === 'unsupported') && <div className="artifact-no-preview"><strong>此文件暂不支持站内预览</strong><p>文件事实和来源仍然保留，可以安全下载后打开。</p></div>}
    {preview.phase === 'error' && <div className="artifact-no-preview"><strong>预览暂不可用</strong><p>{preview.error}</p></div>}
  </>;
}

export function ArtifactContext({ artifact, onResource, onClose }) {
  const preview = useArtifactPreview(artifact, onResource);
  const format = textPreviewFormat(artifact || {});
  const targetLine = Number.isSafeInteger(artifact?.line) && artifact.line > 0 ? artifact.line : 0;
  const [textMode, setTextMode] = useState(format.markdown && !targetLine ? 'preview' : 'source');
  useEffect(() => {
    setTextMode(format.markdown && !targetLine ? 'preview' : 'source');
  }, [artifact?.resourceId, format.markdown, targetLine]);
  if (!artifact) return null;
  const modeActions = format.markdown ? <div className="artifact-preview-mode artifact-preview-mode-header" role="group" aria-label="Markdown 查看方式">
    <button type="button" className={textMode === 'preview' ? 'active' : ''} aria-pressed={textMode === 'preview'} onClick={() => setTextMode('preview')}>预览</button>
    <button type="button" className={textMode === 'source' ? 'active' : ''} aria-pressed={textMode === 'source'} onClick={() => setTextMode('source')}>源码</button>
  </div> : null;
  return <SidePanel className="artifact-context" ariaLabel="文件详情" title={artifact.name} closeLabel="关闭文件详情" headerActions={modeActions} onClose={onClose}>
    <section className="artifact-context-preview" aria-label="文件预览">
      <ArtifactPreviewBody artifact={artifact} preview={preview} textMode={textMode} onTextModeChange={setTextMode} showTextModeControls={false} />
    </section>
  </SidePanel>;
}
