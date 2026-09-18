import React, { useCallback, useLayoutEffect, useRef } from 'react';

// 正文默认露出的行数。真值在 tokens.css 的 --message-fold-lines，这里只是量不到
// 样式时（jsdom）的后备。
export const FOLD_LINES = 14;
// 只比阈值长一点点的正文不折：折起来露 14 行再加一个按钮，和直接放 17 行没区别，
// 却多一次点击。
const FOLD_SLACK_LINES = 4;
const HEURISTIC_CHARS = 1200;
// Folding must be a pure function of the message. Virtualized rows are
// repeatedly unmounted and mounted while the reader scrolls; deriving this
// decision from a post-mount DOM measurement lets the same row change height
// one frame after every remount and makes the list correct its anchor visibly.
// 72 display units is a deliberately coarse desktop line estimate. Exact
// wrapping is not important here; stable classification is.
const APPROX_LINE_UNITS = 72;
const FOCUSABLE_CONTENT = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  'summary',
  '[tabindex]',
  '[contenteditable]:not([contenteditable="false"])',
  'audio[controls]',
  'video[controls]',
].join(',');

function isWideCodePoint(codePoint) {
  return codePoint >= 0x1100 && (
    codePoint <= 0x115f
    || codePoint === 0x2329
    || codePoint === 0x232a
    || (codePoint >= 0x2e80 && codePoint <= 0xa4cf && codePoint !== 0x303f)
    || (codePoint >= 0xac00 && codePoint <= 0xd7a3)
    || (codePoint >= 0xf900 && codePoint <= 0xfaff)
    || (codePoint >= 0xfe10 && codePoint <= 0xfe19)
    || (codePoint >= 0xfe30 && codePoint <= 0xfe6f)
    || (codePoint >= 0xff00 && codePoint <= 0xff60)
    || (codePoint >= 0xffe0 && codePoint <= 0xffe6)
    || (codePoint >= 0x1f300 && codePoint <= 0x1faff)
    || (codePoint >= 0x20000 && codePoint <= 0x3fffd)
  );
}

function displayUnits(value) {
  let units = 0;
  for (const character of value) units += isWideCodePoint(character.codePointAt(0)) ? 2 : 1;
  return units;
}

function estimatedVisualLines(value) {
  return value.split('\n').reduce((total, line) => (
    total + Math.max(1, Math.ceil(displayUnits(line) / APPROX_LINE_UNITS))
  ), 0);
}

// The source is the durable input, so the answer is identical on first mount,
// remount and every browser. Explicit lines cover prose/code blocks; display
// units cover long wrapped paragraphs and CJK without querying layout.
export function foldCandidate(text, { lines = FOLD_LINES, chars = HEURISTIC_CHARS } = {}) {
  const value = String(text || '');
  if (displayUnits(value) >= chars) return true;
  return estimatedVisualLines(value) > lines + FOLD_SLACK_LINES;
}

function countLines(value) {
  let count = 1;
  for (let index = 0; index < value.length; index += 1) if (value.charCodeAt(index) === 10) count += 1;
  return count;
}

// 一段可折叠的正文。折叠与否按内容判，不看发送者：人贴进来的长文和 agent 的长答
// 一样折。三种输入决定状态：
//   expanded  —— 读者手动的选择（true 展开 / false 收起），恒优先；
//   exempt    —— 当前阅读上下文明确要求展开的位置（例如已打开过程详情的那轮）；
//   overflow  —— 源文本按稳定规则超过阈值。
// 只有 overflow 成立才会出现按钮；exempt 的正文默认展开，但读者仍可手动收起。
export function FoldableBody({ id, text = '', exempt = false, expanded, onToggle, className = '', children }) {
  const value = String(text || '');
  const canFold = foldCandidate(value);
  const folded = canFold && (expanded === false || (expanded !== true && !exempt));
  const sourceLines = value ? countLines(value) : 0;
  const reportedLines = sourceLines > 1 ? sourceLines : estimatedVisualLines(value);
  const contentRef = useRef(null);
  const toggleRef = useRef(null);
  const mutedRef = useRef(new Map());

  useLayoutEffect(() => {
    const content = contentRef.current;
    if (!content) return undefined;
    const restore = () => {
      for (const [node, saved] of mutedRef.current) {
        if (saved.tabIndex == null) node.removeAttribute('tabindex');
        else node.setAttribute('tabindex', saved.tabIndex);
        if (saved.ariaHidden == null) node.removeAttribute('aria-hidden');
        else node.setAttribute('aria-hidden', saved.ariaHidden);
      }
      mutedRef.current.clear();
    };
    const apply = () => {
      restore();
      if (!folded) return;
      const clip = content.getBoundingClientRect();
      // A hidden/zero-sized surface is not operable. Its ResizeObserver will
      // apply the boundary when the surface acquires real layout again.
      if (!(clip.bottom > clip.top)) return;
      for (const node of content.querySelectorAll(FOCUSABLE_CONTENT)) {
        const rect = node.getBoundingClientRect();
        const fullyVisible = rect.bottom > rect.top
          && rect.top >= clip.top - 0.5
          && rect.bottom <= clip.bottom + 0.5;
        if (fullyVisible) continue;
        mutedRef.current.set(node, {
          tabIndex: node.getAttribute('tabindex'),
          ariaHidden: node.getAttribute('aria-hidden'),
        });
        node.setAttribute('tabindex', '-1');
        node.setAttribute('aria-hidden', 'true');
      }
      if (mutedRef.current.has(content.ownerDocument.activeElement)) {
        toggleRef.current?.focus({ preventScroll: true });
      }
    };

    apply();
    if (!folded) return restore;
    const resize = typeof ResizeObserver === 'function' ? new ResizeObserver(apply) : null;
    resize?.observe(content);
    for (const child of content.children) resize?.observe(child);
    const mutation = typeof MutationObserver === 'function'
      ? new MutationObserver((records) => {
        if (records.some((record) => record.type === 'childList')) apply();
      })
      : null;
    mutation?.observe(content, { childList: true, subtree: true });
    globalThis.addEventListener?.('resize', apply);
    return () => {
      resize?.disconnect();
      mutation?.disconnect();
      globalThis.removeEventListener?.('resize', apply);
      restore();
    };
  }, [folded, value, children]);

  const toggle = useCallback((event) => {
    onToggle?.(id, folded, event.currentTarget);
  }, [folded, id, onToggle]);

  return <div className={`message-fold${folded ? ' is-folded' : ''} ${className}`.trim()}>
    <div ref={contentRef} className="message-fold-content">{children}</div>
    {canFold && <button ref={toggleRef} type="button" className="message-fold-toggle" data-fold-id={id} aria-expanded={!folded} onClick={toggle}>
      <span aria-hidden="true">⌄</span>
      {folded ? `展开全文 · ${reportedLines} 行` : '收起'}
    </button>}
  </div>;
}
