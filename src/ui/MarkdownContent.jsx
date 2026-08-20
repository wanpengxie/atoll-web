import React from 'react';
import ReactMarkdown from 'react-markdown';
import remarkBreaks from 'remark-breaks';
import remarkGfm from 'remark-gfm';

const REMARK_PLUGINS = [remarkGfm, remarkBreaks];

const COMPONENTS = {
  a: ({ node: _node, ...props }) => <a {...props} target="_blank" rel="noreferrer" />,
  input: ({ node: _node, ...props }) => <input {...props} disabled />,
  table: ({ node: _node, ...props }) => <div className="markdown-table-scroll"><table {...props} /></div>,
};

// 消息正文只接受 CommonMark/GFM AST。react-markdown 默认不会执行原始 HTML，
// 因而账本中的文本不会穿透为 DOM 或脚本。
export function MarkdownContent({ text, className = '' }) {
  return (
    <div className={`markdown-content ${className}`.trim()}>
      <ReactMarkdown remarkPlugins={REMARK_PLUGINS} components={COMPONENTS}>
        {String(text || '')}
      </ReactMarkdown>
    </div>
  );
}
