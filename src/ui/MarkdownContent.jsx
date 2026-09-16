import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import rehypeKatex from 'rehype-katex';
import remarkBreaks from 'remark-breaks';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import 'katex/dist/katex.min.css';
import { parseFileReference } from '../model/file-references.js';
import { normalizeMathMarkdown } from '../model/math-markdown.js';
import { CodeBlock, fenceLanguageOf, textOfNode } from './CodeBlock.jsx';
import { MermaidBlock } from './MermaidBlock.jsx';

const REMARK_PLUGINS = [remarkGfm, remarkMath, remarkBreaks];
const REHYPE_PLUGINS = [[rehypeKatex, { strict: false, throwOnError: false, trust: false }]];

const FileReferenceContext = createContext(null);

export function MarkdownFileReferenceProvider({ onOpen, children }) {
  return <FileReferenceContext.Provider value={onOpen || null}>{children}</FileReferenceContext.Provider>;
}

// Remote Markdown media must not acquire geometry after it becomes visible.
// The frame owns one stable aspect ratio from the first paint; decoding only
// replaces pixels inside it. This is deliberately presentation policy rather
// than a viewport compensation callback.
const StableMarkdownImage = React.memo(function StableMarkdownImage({ src = '', alt = '', title = '', ...props }) {
  const [phase, setPhase] = useState('loading');
  useEffect(() => setPhase('loading'), [src]);
  return <span className="markdown-image-frame" data-image-phase={phase} data-viewport-stable-media="image">
    <span className="markdown-image-status" aria-hidden="true">{phase === 'error' ? '图片无法加载' : '正在加载图片…'}</span>
    <img
      {...props}
      src={src}
      alt={alt}
      title={title || undefined}
      loading="lazy"
      decoding="async"
      onLoad={(event) => { props.onLoad?.(event); setPhase('ready'); }}
      onError={(event) => { props.onError?.(event); setPhase('error'); }}
    />
  </span>;
});

// 消息正文只接受 CommonMark/GFM AST。react-markdown 默认不会执行原始 HTML，
// 因而账本中的文本不会穿透为 DOM 或脚本。
export const MarkdownContent = React.memo(function MarkdownContent({ text, className = '' }) {
  const onOpenFileReference = useContext(FileReferenceContext);
  const source = useMemo(() => normalizeMathMarkdown(text), [text]);
  const components = useMemo(() => ({
    a: ({ node: _node, ...props }) => {
      const reference = onOpenFileReference ? parseFileReference(props.href) : null;
      if (!reference) return <a {...props} target="_blank" rel="noreferrer" />;
      return <a {...props} className={[props.className, 'markdown-file-reference'].filter(Boolean).join(' ')} title="在 Atoll 中预览文件" onClick={(event) => {
        props.onClick?.(event);
        if (event.defaultPrevented) return;
        event.preventDefault();
        onOpenFileReference(reference);
      }} />;
    },
    input: ({ node: _node, ...props }) => <input {...props} disabled />,
    img: ({ node: _node, ...props }) => <StableMarkdownImage {...props} />,
    table: ({ node: _node, ...props }) => <div className="markdown-table-scroll"><table {...props} /></div>,
    // 围栏代码块：<pre> 整个换成 CodeBlock。行内 code 没有 pre 父级，不经这里。
    pre: ({ node }) => {
      const codeNode = (node?.children || []).find((child) => child.type === 'element' && child.tagName === 'code');
      const className = Array.isArray(codeNode?.properties?.className) ? codeNode.properties.className.join(' ') : String(codeNode?.properties?.className || '');
      const language = fenceLanguageOf(className);
      const code = textOfNode(codeNode || node);
      return language.toLowerCase() === 'mermaid'
        ? <MermaidBlock code={code} layoutKey={node?.position?.start?.offset ?? code} />
        : <CodeBlock code={code} language={language} />;
    },
  }), [onOpenFileReference]);
  return (
    <div className={`markdown-content ${className}`.trim()}>
      <ReactMarkdown remarkPlugins={REMARK_PLUGINS} rehypePlugins={REHYPE_PLUGINS} components={components}>
        {source}
      </ReactMarkdown>
    </div>
  );
});
