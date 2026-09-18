import React, { createContext, useContext, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import rehypeKatex from 'rehype-katex';
import remarkBreaks from 'remark-breaks';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import 'katex/dist/katex.min.css';
import { createContentPlanStore } from '../model/content-plan.js';
import { parseFileReference } from '../model/file-references.js';
import { normalizeMathMarkdown } from '../model/math-markdown.js';
import { CodeBlock, fenceLanguageOf, textOfNode } from './CodeBlock.jsx';
import { ContentPlanBlocks } from './ContentPlanBlocks.jsx';
import { MermaidBlock } from './MermaidBlock.jsx';
import { PreparedMarkdown } from './PreparedMarkdown.jsx';

export { describeContentTextPoint, resolveContentTextPoint } from './ContentPlanBlocks.jsx';

const REMARK_PLUGINS = [remarkGfm, remarkMath, remarkBreaks];
const REHYPE_PLUGINS = [[rehypeKatex, { strict: false, throwOnError: false, trust: false }]];
// Prepared trees are retained only while both the entry-count and conservative
// AST byte budgets permit it. Mounted MarkdownContent instances keep their
// committed plan independently, so evicting a prepared tree never remounts or
// truncates visible content.
const CONTENT_PLANS = createContentPlanStore({ limit: 128, preparedByteLimit: 4 * 1024 * 1024 });

const FileReferenceContext = createContext(null);
const MarkdownBlockContext = createContext('');

export function MarkdownFileReferenceProvider({ onOpen, children }) {
  return <FileReferenceContext.Provider value={onOpen || null}>{children}</FileReferenceContext.Provider>;
}

// react-markdown treats a renderer function as the React component type for
// that node. Keep the horizontal overflow owner stable across unrelated
// context/parent renders; replacing this div would discard the browser-owned
// scrollLeft even though the table fact and dimensions did not change.
function MarkdownTable({ node: _node, ...props }) {
  return <div className="markdown-table-scroll"><table {...props} /></div>;
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

function MarkdownLink({ node: _node, ...props }) {
  const onOpenFileReference = useContext(FileReferenceContext);
  const reference = onOpenFileReference ? parseFileReference(props.href) : null;
  if (!reference) return <a {...props} target="_blank" rel="noreferrer" />;
  return <a {...props} className={[props.className, 'markdown-file-reference'].filter(Boolean).join(' ')} title="在 Atoll 中预览文件" onClick={(event) => {
    props.onClick?.(event);
    if (event.defaultPrevented) return;
    event.preventDefault();
    onOpenFileReference(reference);
  }} />;
}

function MarkdownInput({ node: _node, ...props }) {
  return <input {...props} disabled />;
}

function MarkdownPre({ node }) {
  const blockID = useContext(MarkdownBlockContext);
  const codeNode = (node?.children || []).find((child) => child.type === 'element' && child.tagName === 'code');
  const className = Array.isArray(codeNode?.properties?.className) ? codeNode.properties.className.join(' ') : String(codeNode?.properties?.className || '');
  const language = fenceLanguageOf(className);
  const code = textOfNode(codeNode || node);
  return <div>{language.toLowerCase() === 'mermaid'
    ? <MermaidBlock code={code} layoutKey={blockID} />
    : <CodeBlock code={code} language={language} />}</div>;
}

// These component types are independent of a particular MarkdownContent
// mount. Dynamic file-opening and code-block identity arrive through Context,
// so prepared React descriptions remain valid across virtualization remounts.
const MARKDOWN_COMPONENTS = Object.freeze({
  a: MarkdownLink,
  input: MarkdownInput,
  img: StableMarkdownImage,
  table: MarkdownTable,
  pre: MarkdownPre,
});

const BLOCK_RENDERS = new WeakMap();

function renderMarkdownBlock(block) {
  const cached = BLOCK_RENDERS.get(block);
  if (cached) return cached;
  const content = block.preparedRoot
    ? <PreparedMarkdown root={block.preparedRoot} components={MARKDOWN_COMPONENTS} />
    : <ReactMarkdown remarkPlugins={REMARK_PLUGINS} rehypePlugins={REHYPE_PLUGINS} components={MARKDOWN_COMPONENTS}>
      {block.renderSource}
    </ReactMarkdown>;
  const rendered = <MarkdownBlockContext.Provider value={block.blockID}>{content}</MarkdownBlockContext.Provider>;
  BLOCK_RENDERS.set(block, rendered);
  return rendered;
}

// 消息正文只接受 CommonMark/GFM AST。react-markdown 默认不会执行原始 HTML，
// 因而账本中的文本不会穿透为 DOM 或脚本。
export const MarkdownContent = React.memo(function MarkdownContent({ text, className = '', contentKey = '' }) {
  const source = useMemo(() => normalizeMathMarkdown(text), [text]);
  const localID = useId();
  const resolvedContentKey = contentKey || `mounted-markdown:${localID}`;
  const committedRef = useRef({ contentKey: '', plan: null });
  const plan = useMemo(() => {
    const previous = committedRef.current.contentKey === resolvedContentKey
      ? committedRef.current.plan
      : CONTENT_PLANS.get(resolvedContentKey);
    return CONTENT_PLANS.prepare(resolvedContentKey, source, { previous });
  }, [resolvedContentKey, source]);
  useLayoutEffect(() => {
    // Publish only a plan whose DOM committed. An abandoned concurrent render
    // cannot become the identity source for a later remount.
    CONTENT_PLANS.commit(plan);
    committedRef.current = { contentKey: resolvedContentKey, plan };
  }, [plan, resolvedContentKey]);
  return (
    <div
      className={`markdown-content ${className}`.trim()}
      data-reading-content-key={resolvedContentKey}
      data-reading-content-revision={plan.revision}
    >
      <ContentPlanBlocks plan={plan} renderBlock={renderMarkdownBlock} />
    </div>
  );
});
