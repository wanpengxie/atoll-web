import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Highlight, themes } from 'prism-react-renderer';

// 围栏代码块的语言名 → prism 的语法名。prism-react-renderer 只内置一小组语法
// （markup / css / clike / javascript / jsx / tsx / go / python / json / sql /
// yaml / markdown / rust / swift / kotlin / cpp / graphql …）。不认识的一律按
// 纯文本着色：只丢高亮，不丢内容，语言标签照样显示作者写的那个名字。
const LANGUAGE_ALIASES = Object.freeze({
  js: 'javascript', mjs: 'javascript', cjs: 'javascript', javascript: 'javascript',
  ts: 'typescript', typescript: 'typescript', tsx: 'tsx', jsx: 'jsx',
  py: 'python', python: 'python', golang: 'go', go: 'go',
  yml: 'yaml', yaml: 'yaml', json: 'json', json5: 'json',
  html: 'markup', xml: 'markup', svg: 'markup', markup: 'markup',
  css: 'css', sql: 'sql', rs: 'rust', rust: 'rust', swift: 'swift', kt: 'kotlin', kotlin: 'kotlin',
  c: 'c', cpp: 'cpp', 'c++': 'cpp', cc: 'cpp', h: 'c', hpp: 'cpp',
  md: 'markdown', markdown: 'markdown', graphql: 'graphql', objc: 'objectivec', objectivec: 'objectivec',
});

export function prismLanguageOf(name) {
  const key = String(name || '').trim().toLowerCase();
  return LANGUAGE_ALIASES[key] || 'plain';
}

// 从 ```lang 围栏里拿到的名字。react-markdown 把它放在 <code class="language-lang">。
export function fenceLanguageOf(className) {
  const match = /(?:^|\s)language-([\w+#.-]+)/.exec(String(className || ''));
  return match ? match[1] : '';
}

// 超过这么多行才显示行号：三两行的片段配行号是噪音。
const LINE_NUMBERS_FROM = 5;

function CopyButton({ code }) {
  const [state, setState] = useState('idle');
  const timerRef = useRef(null);
  useEffect(() => () => clearTimeout(timerRef.current), []);
  const copy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(code);
      setState('done');
    } catch {
      setState('failed');
    }
    clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => setState('idle'), 1600);
  }, [code]);
  const label = state === 'done' ? '已复制' : state === 'failed' ? '复制失败' : '复制';
  return <button type="button" className="code-block-copy" onClick={copy} aria-live="polite">{label}</button>;
}

// 一个围栏代码块：顶栏（语言名 + 复制）、语法高亮、长块行号。结构保持
// <pre><code> 不变，读账本的测试和复制选区都还认得它。
export function CodeBlock({ code = '', language = '' }) {
  const source = String(code).replace(/\n$/, '');
  const prismLanguage = prismLanguageOf(language);
  const lineCount = source.split('\n').length;
  const numbered = lineCount >= LINE_NUMBERS_FROM;
  return <figure className={`code-block${numbered ? ' is-numbered' : ''}`} data-language={language || undefined}>
    <div className="code-block-bar">
      <span className="code-block-lang">{language || 'text'}</span>
      <CopyButton code={source} />
    </div>
    <Highlight theme={themes.oneLight} code={source} language={prismLanguage}>
      {({ className, tokens, getLineProps, getTokenProps }) => <pre className={`code-block-pre ${className}`.trim()}>
        <code className={language ? `language-${language}` : undefined}>
          {tokens.map((line, index) => {
            const lineProps = getLineProps({ line });
            return <span {...lineProps} className={`code-block-line ${lineProps.className || ''}`.trim()} key={index}>
              {numbered && <span className="code-block-line-number" aria-hidden="true">{index + 1}</span>}
              <span className="code-block-line-code">{line.map((token, tokenIndex) => <span {...getTokenProps({ token })} key={tokenIndex} />)}{'\n'}</span>
            </span>;
          })}
        </code>
      </pre>}
    </Highlight>
  </figure>;
}

// 把 hast 的 <pre><code>…</code></pre> 节点还原成源码字符串。
export function textOfNode(node) {
  if (!node) return '';
  if (node.type === 'text') return node.value || '';
  return (node.children || []).map(textOfNode).join('');
}
