import React, { useEffect, useId, useState } from 'react';
import { CodeBlock } from './CodeBlock.jsx';

let mermaidPromise;
const diagramCache = new Map();
const DIAGRAM_CACHE_LIMIT = 48;

function loadMermaid() {
  if (!mermaidPromise) {
    mermaidPromise = import('mermaid').then(({ default: mermaid }) => {
      mermaid.initialize({
        startOnLoad: false,
        securityLevel: 'strict',
        suppressErrorRendering: true,
        theme: 'neutral',
      });
      return mermaid;
    });
  }
  return mermaidPromise;
}

function cachedResult(source) {
  const entry = diagramCache.get(source);
  if (entry) {
    // Read access is what makes this an LRU rather than insertion-order FIFO.
    diagramCache.delete(source);
    diagramCache.set(source, entry);
  }
  if (entry?.status === 'ready') return { status: 'ready', svg: entry.svg, error: '' };
  if (entry?.status === 'error') return { status: 'error', svg: '', error: entry.error };
  return { status: 'loading', svg: '', error: '' };
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Mermaid's SVG contains document-global marker/clipPath IDs. The cached SVG
// is a canonical render; every mounted block receives its own scoped IDs so two
// identical diagrams cannot cross-reference each other's arrows or masks.
export function scopeMermaidSvg(svg, scope) {
  const source = String(svg || '');
  const ids = [...source.matchAll(/\bid=(['"])([^'"]+)\1/g)].map((match) => match[2]);
  let result = source;
  [...new Set(ids)].forEach((id, index) => {
    const next = `${scope}-${index}`;
    const escaped = escapeRegExp(id);
    result = result
      .replace(new RegExp(`\\bid=(['"])${escaped}\\1`, 'g'), (_match, quote) => `id=${quote}${next}${quote}`)
      .replace(new RegExp(`#${escaped}(?=[^\\w:.-]|$)`, 'g'), `#${next}`);
  });
  return result;
}

function resultForInstance(source, scope) {
  const result = cachedResult(source);
  return result.status === 'ready' ? { ...result, svg: scopeMermaidSvg(result.svg, scope) } : result;
}

function renderDiagram(source, id) {
  let entry = diagramCache.get(source);
  if (entry) return entry.promise;
  entry = { status: 'loading', svg: '', error: '', promise: null };
  entry.promise = loadMermaid()
    .then((mermaid) => mermaid.render(id, source))
    .then(({ svg }) => {
      Object.assign(entry, { status: 'ready', svg });
      while (diagramCache.size > DIAGRAM_CACHE_LIMIT) {
        const oldest = [...diagramCache].find(([, value]) => value.status !== 'loading')?.[0];
        if (oldest === undefined) break;
        diagramCache.delete(oldest);
      }
      return { svg };
    })
    .catch((error) => {
      const message = error?.message || '无法渲染这张图';
      Object.assign(entry, { status: 'error', error: message });
      throw error;
    });
  diagramCache.set(source, entry);
  if (diagramCache.size > DIAGRAM_CACHE_LIMIT) {
    const oldest = [...diagramCache].find(([, value]) => value.status !== 'loading')?.[0];
    if (oldest !== undefined) diagramCache.delete(oldest);
  }
  return entry.promise;
}

export function clearMermaidDiagramCache() {
  diagramCache.clear();
}

export function MermaidBlock({ code = '' }) {
  const source = String(code).replace(/\n$/, '');
  const reactId = useId();
  const instanceScope = `mermaid-instance-${reactId.replace(/[^\w-]/g, '')}`;
  const [mode, setMode] = useState('diagram');
  const [rendered, setRendered] = useState(() => resultForInstance(source, instanceScope));

  useEffect(() => {
    let current = true;
    setRendered(resultForInstance(source, instanceScope));
    // StrictMode 会双调 effect，虚拟消息列表也会卸载屏外条目。缓存 promise 让前者
    // 不并发画两次，缓存结果让后者重新出现时首帧直接复用 SVG，不再源码/图表闪烁。
    renderDiagram(source, `mermaid-${reactId.replace(/[^\w-]/g, '')}`)
      .then(({ svg }) => {
        if (current) setRendered({ status: 'ready', svg: scopeMermaidSvg(svg, instanceScope), error: '' });
      })
      .catch((error) => {
        if (current) setRendered({ status: 'error', svg: '', error: error?.message || '无法渲染这张图' });
      });
    return () => { current = false; };
  }, [instanceScope, reactId, source]);

  if (mode === 'source') {
    return <div className="mermaid-block is-source">
      <button type="button" className="mermaid-mode-toggle" data-viewport-layout-action onClick={() => setMode('diagram')}>查看图表</button>
      <CodeBlock code={source} language="mermaid" />
    </div>;
  }

  return <figure className="mermaid-block">
    <div className="mermaid-block-bar">
      <span>mermaid</span>
      <button type="button" className="mermaid-mode-toggle" data-viewport-layout-action onClick={() => setMode('source')}>查看源码</button>
    </div>
    <div className="mermaid-stage" data-mermaid-phase={rendered.status} data-viewport-stable-media="mermaid">
      {rendered.status === 'loading' && <div className="mermaid-status" role="status">正在绘图…</div>}
      {rendered.status === 'error' && <div className="mermaid-error" role="alert">
        <strong>图表语法有误</strong>
        <span>{rendered.error}</span>
        <CodeBlock code={source} language="mermaid" />
      </div>}
      {rendered.status === 'ready' && <div className="mermaid-diagram" role="img" aria-label="Mermaid 图表" dangerouslySetInnerHTML={{ __html: rendered.svg }} />}
    </div>
  </figure>;
}
