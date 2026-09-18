import React, { useEffect, useRef, useState } from 'react';
import { ArrowLeft, Download } from 'lucide-react';
import { Highlight, themes } from 'prism-react-renderer';
import { artifactKindForMediaType, formatArtifactSize, previewForMediaType } from '../../model/artifacts.js';
import { fileTransferURL, mediaTypeFromFileName } from '../../model/channel-file-transfer.js';
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

// 调用方带来的分类可能是按 "application/octet-stream" 判的（消息附件、agent 引用的
// 文件常常不带类型），那等于什么都不知道。这里按文件名再判一次；扩展名认得的，
// 就按认得的走。认不得的留给下面的内容嗅探。
export function resolveArtifact(artifact) {
  if (!artifact) return artifact;
  const mediaType = mediaTypeFromFileName(artifact.name, artifact.mediaType);
  if (mediaType === (artifact.mediaType || '') && artifact.preview) return artifact;
  const kind = artifact.kind && artifact.kind !== 'file' && artifact.kind !== 'other' ? artifact.kind : artifactKindForMediaType(mediaType);
  return { ...artifact, mediaType, preview: previewForMediaType(mediaType), kind };
}

// 服务端没说清类型时（缺失或 octet-stream），用我们判定出的类型重打 blob；
// 服务端说了具体类型就尊重它。
export function typedBlob(blob, mediaType) {
  const declared = String(blob?.type || '').toLowerCase();
  const wanted = String(mediaType || '').toLowerCase().split(';')[0].trim();
  if (!wanted || wanted === 'application/octet-stream') return blob;
  if (declared && declared !== 'application/octet-stream') return blob;
  return new Blob([blob], { type: wanted });
}

const SNIFF_WINDOW = 8 * 1024;

// 类型认不出来的文件，看内容：前 8KB 里没有 NUL 字节，而且整体是合法 UTF-8，就当文本。
// 二进制文件几乎总在开头就有 NUL；反过来能完整解码成 UTF-8 的字节流基本不是二进制。
export function looksLikeText(bytes) {
  if (!bytes || bytes.byteLength === 0) return '';
  const head = bytes.subarray(0, SNIFF_WINDOW);
  for (let index = 0; index < head.length; index += 1) if (head[index] === 0) return null;
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return null;
  }
}

export function useArtifactPreview(rawArtifact, onResource, onFileOperation) {
  const [preview, setPreview] = useState({ phase: 'idle', url: '', text: '', error: '' });
  const artifact = resolveArtifact(rawArtifact);
  const previewKind = artifact?.preview;
  const resourceKey = artifact ? `${artifact.channelId}:${artifact.resourceId}:${previewKind}:${artifact.size ?? ''}` : '';
  useEffect(() => {
    let alive = true;
    let objectURL = '';
    const controller = new AbortController();
    setPreview({ phase: 'idle', url: '', text: '', error: '' });
    if (!artifact || !['text', 'image', 'media', 'inline', 'unsupported'].includes(previewKind)) return () => controller.abort();
    const sniff = previewKind === 'unsupported';
    const limit = previewLimit(sniff ? 'text' : previewKind);
    if (Number.isFinite(artifact.size) && artifact.size > limit) {
      setPreview(sniff ? { phase: 'unsupported', url: '', text: '', error: '' } : { phase: 'error', url: '', text: '', error: sizeError(limit) });
      return () => controller.abort();
    }
    setPreview({ phase: 'loading', url: '', text: '', error: '' });
    const load = async (operation) => {
      const receipt = await operation.resource(readFileTicket({ channelId: artifact.channelId, resourceId: artifact.resourceId }));
      // 只需要票。地址是调用方自己带来的（消息里存的就是路径），回执不必再说一遍。
      if (!receipt?.ticket) throw new TypeError('服务端没有返回可读凭据');
      const response = await operation.fetch(fileTransferURL(artifact.channelId, receipt.ticket), { credentials: 'include' });
      if (!response.ok) throw new TypeError(`预览读取失败 (${response.status})`);
      const declared = Number(response.headers?.get?.('content-length') || 0);
      if (declared > limit) throw new RangeError(sizeError(limit));
      if (previewKind === 'text') {
        return { phase: 'ready', text: await readBoundedText(response, limit, operation.signal), url: '', error: '' };
      }
      if (sniff) {
        const buffer = await response.arrayBuffer();
        if (buffer.byteLength > limit) throw new RangeError(sizeError(limit));
        const value = looksLikeText(new Uint8Array(buffer));
        return value === null
          ? { phase: 'unsupported', url: '', text: '', error: '' }
          : { phase: 'ready', text: value, url: '', error: '', sniffed: true };
      }
      const raw = await response.blob();
      if (raw.size > limit) throw new RangeError(sizeError(limit));
      return { phase: 'ready', raw };
    };
    const pending = onFileOperation
      ? onFileOperation({ channelId: artifact.channelId, access: 'read', signal: controller.signal }, load)
      : load({
        signal: controller.signal,
        resource: onResource,
        fetch: (input, init = {}) => fetch(input, { ...init, signal: controller.signal }),
      });
    pending.then((result) => {
      if (!alive) return;
      if (!result.raw) { setPreview(result); return; }
      // 节点的 /files 下载口一律回 application/octet-stream 加 attachment（那是
      // 下载安全的刻意设计）；预览只在 owner settle 后创建 renderer handle。
      const blob = typedBlob(result.raw, artifact.mediaType);
      objectURL = URL.createObjectURL(blob);
      if (!alive) URL.revokeObjectURL(objectURL);
      else setPreview({ phase: 'ready', url: objectURL, text: '', error: '' });
    }).catch((error) => { if (alive && error?.name !== 'AbortError') setPreview({ phase: 'error', url: '', text: '', error: error.message || String(error) }); });
    return () => { alive = false; controller.abort(); if (objectURL) URL.revokeObjectURL(objectURL); };
  // eslint-disable-next-line react-hooks/exhaustive-deps -- resolveArtifact 每次返回新对象，按稳定键重跑
  }, [resourceKey, onFileOperation, onResource]);
  return preview;
}

// 预览到的正文是否可复制：文本类，或嗅探出来是文本的。
export function previewText(artifact, preview) {
  if (preview?.phase !== 'ready') return null;
  const resolved = resolveArtifact(artifact);
  if (resolved?.preview === 'text' || preview.sniffed) return preview.text ?? '';
  return null;
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

// sandbox 留空：不跑脚本、不同源、不能导航父页，文件里的内容只能画自己。
function HtmlArtifactPreview({ text, name }) {
  return <iframe className="artifact-html-preview" sandbox="" srcDoc={String(text || '')} title={name || 'HTML 预览'} />;
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
  const { markdown, html, rich, language } = textPreviewFormat(artifact);
  const targetLine = Number.isSafeInteger(artifact.line) && artifact.line > 0 ? artifact.line : 0;
  const [localMode, setLocalMode] = useState(rich && !targetLine ? 'preview' : 'source');
  const mode = controlledMode || localMode;
  const changeMode = (nextMode) => {
    setLocalMode(nextMode);
    onModeChange?.(nextMode);
  };
  useEffect(() => {
    setLocalMode(rich && !targetLine ? 'preview' : 'source');
  }, [artifact.resourceId, rich, targetLine]);
  return <div className="artifact-text-preview">
    {rich && showModeControls && <div className="artifact-preview-mode" role="group" aria-label={markdown ? 'Markdown 查看方式' : 'HTML 查看方式'}>
      <button type="button" className={mode === 'preview' ? 'active' : ''} aria-pressed={mode === 'preview'} onClick={() => changeMode('preview')}>预览</button>
      <button type="button" className={mode === 'source' ? 'active' : ''} aria-pressed={mode === 'source'} onClick={() => changeMode('source')}>源码</button>
    </div>}
    {markdown && mode === 'preview'
      ? <MarkdownContent contentKey={`artifact:${artifact.resourceId}:preview`} text={text} className="artifact-markdown-preview" />
      : html && mode === 'preview'
        ? <HtmlArtifactPreview text={text} name={artifact.name} />
        : <SourceArtifactPreview text={text} line={targetLine} language={language} />}
  </div>;
}

function downloadFact(artifact) {
  return {
    resource_id: artifact.resourceId,
    name: artifact.name,
    media_type: artifact.mediaType,
    ...(artifact.size === undefined ? {} : { size: artifact.size }),
  };
}

function ArtifactNoPreview({ artifact, title, detail, onDownload }) {
  return <div className="artifact-no-preview">
    <strong>{title}</strong>
    <p>{detail}</p>
    {onDownload && <button type="button" className="artifact-download-action" aria-label={`下载 ${artifact.name}`} onClick={() => onDownload(downloadFact(artifact))}>
      <Download size={15} aria-hidden="true" />
      下载原文件
    </button>}
  </div>;
}

export function ArtifactPreviewBody({ artifact: rawArtifact, preview, textMode, onTextModeChange, showTextModeControls = true, onDownload }) {
  const artifact = resolveArtifact(rawArtifact);
  if (!artifact) return null;
  const textReady = preview.phase === 'ready' && (artifact.preview === 'text' || preview.sniffed);
  return <>
    {preview.phase === 'loading' && <p>正在加载预览…</p>}
    {textReady && <TextArtifactPreview artifact={artifact} text={preview.text} mode={textMode} onModeChange={onTextModeChange} showModeControls={showTextModeControls} />}
    {preview.phase === 'ready' && artifact.preview === 'image' && <img src={preview.url} alt={artifact.name} />}
    {preview.phase === 'ready' && artifact.preview === 'media' && (artifact.kind === 'audio' ? <audio src={preview.url} controls /> : <video src={preview.url} controls />)}
    {preview.phase === 'ready' && artifact.preview === 'inline' && <object className="artifact-pdf" data={preview.url} type="application/pdf" aria-label={artifact.name}>
      {/* 浏览器没有内嵌 PDF 查看器时（部分移动端、无头环境）才会显示这段 */}
      <ArtifactNoPreview artifact={artifact} title="这个浏览器不能内嵌显示 PDF" detail="可以下载后用系统查看器打开。" onDownload={onDownload} />
    </object>}
    {(artifact.preview === 'download_only' || preview.phase === 'unsupported') && <ArtifactNoPreview artifact={artifact} title="此文件暂不支持站内预览" detail="文件事实和来源仍然保留，可以安全下载后打开。" onDownload={onDownload} />}
    {preview.phase === 'error' && <ArtifactNoPreview artifact={artifact} title="预览暂不可用" detail={preview.error} onDownload={onDownload} />}
  </>;
}

export function ArtifactContext({ artifact: rawArtifact, onResource, onFileOperation, onDownload, canGoBack = false, onBack, onClose }) {
  const artifact = resolveArtifact(rawArtifact);
  const preview = useArtifactPreview(artifact, onResource, onFileOperation);
  const format = textPreviewFormat(artifact || {});
  const targetLine = Number.isSafeInteger(artifact?.line) && artifact.line > 0 ? artifact.line : 0;
  const [textMode, setTextMode] = useState(format.rich && !targetLine ? 'preview' : 'source');
  useEffect(() => {
    setTextMode(format.rich && !targetLine ? 'preview' : 'source');
  }, [artifact?.resourceId, format.rich, targetLine]);
  if (!artifact) return null;
  const copyable = previewText(artifact, preview);
  const modeActions = (canGoBack || format.rich || copyable !== null) ? <div className="artifact-preview-mode artifact-preview-mode-header" role="group" aria-label="文件操作">
    {canGoBack && <button type="button" className="artifact-back" aria-label="返回上一个文件" title="返回上一个文件" onClick={onBack}><ArrowLeft size={15} /></button>}
    {format.rich && <>
      <button type="button" className={textMode === 'preview' ? 'active' : ''} aria-pressed={textMode === 'preview'} onClick={() => setTextMode('preview')}>预览</button>
      <button type="button" className={textMode === 'source' ? 'active' : ''} aria-pressed={textMode === 'source'} onClick={() => setTextMode('source')}>源码</button>
    </>}
    {copyable !== null && <CopyPreviewButton text={copyable} />}
  </div> : null;
  return <SidePanel className="artifact-context" ariaLabel="文件详情" title={artifact.name} closeLabel="关闭文件详情" headerActions={modeActions} onClose={onClose}>
    <section className="artifact-context-preview" aria-label="文件预览">
      <ArtifactPreviewBody artifact={artifact} preview={preview} textMode={textMode} onTextModeChange={setTextMode} showTextModeControls={false} onDownload={onDownload} />
    </section>
  </SidePanel>;
}
