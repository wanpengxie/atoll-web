import React, { useRef, useState } from 'react';
import { artifactAttachment, formatArtifactSize } from '../model/artifacts.js';
import { ArtifactPreviewBody, useArtifactPreview } from './context/ArtifactContext.jsx';
import { useModalFocus } from './primitives/useModalFocus.js';

const MIN_ZOOM = 0.5;
const MAX_ZOOM = 2;
const ZOOM_STEP = 0.25;

export function FilePreviewModal({ artifact, onResource, onAttach, onDownload, onClose }) {
  const dialogRef = useRef(null);
  const closeRef = useRef(null);
  const [zoom, setZoom] = useState(1);
  const preview = useArtifactPreview(artifact, onResource);
  useModalFocus({ dialogRef, initialFocusRef: closeRef, onClose });
  if (!artifact) return null;
  const attachment = artifactAttachment(artifact);
  const zoomable = ['text', 'image', 'inline'].includes(artifact.preview);

  return <div className="file-preview-backdrop" data-modal-layer role="presentation" onMouseDown={(event) => {
    if (event.target === event.currentTarget) onClose?.();
  }}>
    <section ref={dialogRef} tabIndex={-1} className="file-preview-modal" role="dialog" aria-modal="true" aria-label={`文件预览：${artifact.name}`}>
      <header className="file-preview-header">
        <div className="file-preview-identity"><span aria-hidden="true">◇</span><div><strong>{artifact.name}</strong><small>{artifact.mediaType} · {formatArtifactSize(artifact.size)}</small></div></div>
        <div className="file-preview-actions"><button type="button" onClick={() => onAttach?.(attachment)}>附加到消息</button><button type="button" onClick={() => onDownload?.(attachment)}>下载</button><button ref={closeRef} type="button" className="file-preview-close" aria-label="关闭文件预览" onClick={onClose}>×</button></div>
      </header>
      <div className={`file-preview-stage kind-${artifact.preview}`} aria-label="预览画布">
        <div className="file-preview-document" style={zoomable ? { zoom } : undefined}>
          <ArtifactPreviewBody artifact={artifact} preview={preview} />
        </div>
      </div>
      {zoomable && <div className="file-preview-controls" aria-label="预览缩放">
        <button type="button" aria-label="缩小" disabled={zoom <= MIN_ZOOM} onClick={() => setZoom((value) => Math.max(MIN_ZOOM, value - ZOOM_STEP))}>−</button>
        <span>{Math.round(zoom * 100)}%</span>
        <button type="button" aria-label="放大" disabled={zoom >= MAX_ZOOM} onClick={() => setZoom((value) => Math.min(MAX_ZOOM, value + ZOOM_STEP))}>＋</button>
      </div>}
    </section>
  </div>;
}
