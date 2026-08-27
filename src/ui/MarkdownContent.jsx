import React, { createContext, useContext, useMemo } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkBreaks from 'remark-breaks';
import remarkGfm from 'remark-gfm';
import { parseFileReference } from '../model/file-references.js';

const REMARK_PLUGINS = [remarkGfm, remarkBreaks];

const FileReferenceContext = createContext(null);

export function MarkdownFileReferenceProvider({ onOpen, children }) {
  return <FileReferenceContext.Provider value={onOpen || null}>{children}</FileReferenceContext.Provider>;
}

// 消息正文只接受 CommonMark/GFM AST。react-markdown 默认不会执行原始 HTML，
// 因而账本中的文本不会穿透为 DOM 或脚本。
export function MarkdownContent({ text, className = '' }) {
  const onOpenFileReference = useContext(FileReferenceContext);
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
    table: ({ node: _node, ...props }) => <div className="markdown-table-scroll"><table {...props} /></div>,
  }), [onOpenFileReference]);
  return (
    <div className={`markdown-content ${className}`.trim()}>
      <ReactMarkdown remarkPlugins={REMARK_PLUGINS} components={components}>
        {String(text || '')}
      </ReactMarkdown>
    </div>
  );
}
