import React, { createContext, useContext, useMemo } from 'react';
import ReactMarkdown from 'react-markdown';
import rehypeKatex from 'rehype-katex';
import remarkBreaks from 'remark-breaks';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import 'katex/dist/katex.min.css';
import { parseFileReference } from '../model/file-references.js';
import { normalizeMathMarkdown } from '../model/math-markdown.js';
import { CodeBlock, fenceLanguageOf, textOfNode } from './CodeBlock.jsx';

const REMARK_PLUGINS = [remarkGfm, remarkMath, remarkBreaks];
const REHYPE_PLUGINS = [[rehypeKatex, { strict: false, throwOnError: false, trust: false }]];

const FileReferenceContext = createContext(null);

export function MarkdownFileReferenceProvider({ onOpen, children }) {
  return <FileReferenceContext.Provider value={onOpen || null}>{children}</FileReferenceContext.Provider>;
}

// 消息正文只接受 CommonMark/GFM AST。react-markdown 默认不会执行原始 HTML，
// 因而账本中的文本不会穿透为 DOM 或脚本。
export function MarkdownContent({ text, className = '' }) {
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
    table: ({ node: _node, ...props }) => <div className="markdown-table-scroll"><table {...props} /></div>,
    // 围栏代码块：<pre> 整个换成 CodeBlock。行内 code 没有 pre 父级，不经这里。
    pre: ({ node }) => {
      const codeNode = (node?.children || []).find((child) => child.type === 'element' && child.tagName === 'code');
      const className = Array.isArray(codeNode?.properties?.className) ? codeNode.properties.className.join(' ') : String(codeNode?.properties?.className || '');
      return <CodeBlock code={textOfNode(codeNode || node)} language={fenceLanguageOf(className)} />;
    },
  }), [onOpenFileReference]);
  return (
    <div className={`markdown-content ${className}`.trim()}>
      <ReactMarkdown remarkPlugins={REMARK_PLUGINS} rehypePlugins={REHYPE_PLUGINS} components={components}>
        {source}
      </ReactMarkdown>
    </div>
  );
}
