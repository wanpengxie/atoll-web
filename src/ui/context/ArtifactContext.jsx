import React, { useEffect, useState } from 'react';
import { artifactAttachment, formatArtifactSize } from '../../model/artifacts.js';
import { readFileTicket } from '../../model/resources.js';
import { SidePanel } from '../primitives/SidePanel.jsx';

function resourceURL(address, ticket) {
  return `/files/${encodeURIComponent(address)}?t=${encodeURIComponent(ticket)}`;
}

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
      if (!receipt?.ticket || !receipt?.address) throw new TypeError('服务端没有返回可读凭据');
      const response = await fetch(resourceURL(receipt.address, receipt.ticket), { credentials: 'include', signal: controller.signal });
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

export function ArtifactPreviewBody({ artifact, preview }) {
  if (!artifact) return null;
  return <>
    {preview.phase === 'loading' && <p>正在加载预览…</p>}
    {preview.phase === 'ready' && artifact.preview === 'text' && <pre>{preview.text}</pre>}
    {preview.phase === 'ready' && artifact.preview === 'image' && <img src={preview.url} alt={artifact.name} />}
    {preview.phase === 'ready' && artifact.preview === 'media' && (artifact.kind === 'audio' ? <audio src={preview.url} controls /> : <video src={preview.url} controls />)}
    {preview.phase === 'ready' && artifact.preview === 'inline' && <iframe src={preview.url} title={artifact.name} />}
    {(artifact.preview === 'download_only' || artifact.preview === 'unsupported') && <div className="artifact-no-preview"><strong>此文件暂不支持站内预览</strong><p>文件事实和来源仍然保留，可以安全下载后打开。</p></div>}
    {preview.phase === 'error' && <div className="artifact-no-preview"><strong>预览暂不可用</strong><p>{preview.error}</p></div>}
  </>;
}

export function ArtifactContext({ artifact, authorName, onResource, onDownload, onAttach, onSource, onClose }) {
  const preview = useArtifactPreview(artifact, onResource);
  if (!artifact) return null;
  const mounted = artifact.provenance?.source === 'channel_mount';
  return <SidePanel className="artifact-context" ariaLabel="文件详情" eyebrow={mounted ? 'CHANNEL FILE' : 'FILE REFERENCE'} title={artifact.name} closeLabel="关闭文件详情" onClose={onClose}>
    <section className="artifact-context-preview" aria-label="文件预览">
      <ArtifactPreviewBody artifact={artifact} preview={preview} />
    </section>
    <dl className="artifact-metadata"><dt>类型</dt><dd>{artifact.mediaType}</dd><dt>大小</dt><dd>{formatArtifactSize(artifact.size)}</dd>{mounted ? <><dt>位置</dt><dd>当前频道挂载目录</dd></> : <><dt>作者</dt><dd>{authorName || '未知作者'}</dd><dt>来源</dt><dd>频道动态 #{artifact.source.seq}</dd></>}{artifact.versionOf && <><dt>版本关系</dt><dd>明确基于另一个产物</dd></>}</dl>
    <div className="artifact-context-actions">{artifact.source && onSource && <button type="button" onClick={() => onSource(artifact.source)}>查看来源</button>}<button type="button" onClick={() => onAttach(artifactAttachment(artifact))}>附加到消息</button><button type="button" className="primary-button" onClick={() => onDownload(artifactAttachment(artifact))}>下载</button></div>
  </SidePanel>;
}
