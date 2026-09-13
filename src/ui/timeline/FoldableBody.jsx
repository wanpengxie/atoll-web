import React, { useCallback, useLayoutEffect, useRef, useState } from 'react';

// 正文默认露出的行数。真值在 tokens.css 的 --message-fold-lines，这里只是量不到
// 样式时（jsdom）的后备。
export const FOLD_LINES = 14;
// 只比阈值长一点点的正文不折：折起来露 14 行再加一个按钮，和直接放 17 行没区别，
// 却多一次点击。
const FOLD_SLACK_LINES = 4;
const HEURISTIC_CHARS = 1200;
const DEFINITELY_SHORT_CHARS = 96;

// 量不到布局时（测试环境）的判据：源文本行数或字符数。生产里恒以真实渲染高度为准，
// 因为表格、代码块的行数和字符数对不上。
export function foldCandidate(text, { lines = FOLD_LINES, chars = HEURISTIC_CHARS } = {}) {
  const value = String(text || '');
  if (value.length >= chars) return true;
  return countLines(value) > lines + FOLD_SLACK_LINES;
}

function countLines(value) {
  let count = 1;
  for (let index = 0; index < value.length; index += 1) if (value.charCodeAt(index) === 10) count += 1;
  return count;
}

// 这些正文在最窄的支持屏幕上也不可能超过折叠阈值。它们占时间线的
// 绝大多数，恒不为了得到“不折”这个已知答案去读 scrollHeight、创建 observer。
function definitelyShort(text) {
  const value = String(text || '');
  return value.length <= DEFINITELY_SHORT_CHARS && countLines(value) <= 4;
}

function scrollParentOf(element) {
  for (let node = element.parentElement; node; node = node.parentElement) {
    const { overflowY } = getComputedStyle(node);
    if (overflowY === 'auto' || overflowY === 'scroll') return node;
  }
  return null;
}

function foldLinesOf(element) {
  const raw = getComputedStyle(element).getPropertyValue('--message-fold-lines');
  const parsed = Number.parseFloat(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : FOLD_LINES;
}

// 一段可折叠的正文。折叠与否按内容判，不看发送者：人贴进来的长文和 agent 的长答
// 一样折。三种输入决定状态：
//   expanded  —— 读者手动的选择（true 展开 / false 收起），恒优先；
//   exempt    —— 默认不折的位置（时间线最新一轮、正在查看过程的那轮）；
//   overflow  —— 内容真的超过阈值，量出来的。
// 只有 overflow 成立才会出现按钮；exempt 的正文默认展开，但读者仍可手动收起。
export function FoldableBody({ id, text = '', exempt = false, expanded, onToggle, className = '', children }) {
  const contentRef = useRef(null);
  // 首次渲染就按源文本先判一次，明显超长的正文第一帧就是折叠态。这不只是少一次
  // 闪动：条目挂载后若在 layout effect 里才切成折叠，尺寸会立即再变一次，
  // 虚拟列表的 observer 也会跟着重算。
  // 真实高度量出来后仍以量到的为准，只在临界情况下会纠正这次预判。
  const [measure, setMeasure] = useState(() => (text ? { text, overflow: foldCandidate(text), lines: countLines(String(text)) } : { text: '', overflow: null, lines: 0 }));
  const textRef = useRef(text);
  textRef.current = text;
  const measureFrameRef = useRef(0);
  const toggleRef = useRef(null);
  const foldAnchorRef = useRef(null);
  const foldObserverRef = useRef(null);
  const needsMeasurement = !definitelyShort(text);

  useLayoutEffect(() => {
    const element = contentRef.current;
    if (!element || !needsMeasurement) return undefined;
    const evaluate = () => {
      measureFrameRef.current = 0;
      const currentText = String(textRef.current || '');
      // scrollHeight 是内容的真实高度，折起时 max-height 截掉的部分也算在内；用
      // offsetHeight 会在折起后量到截断值，判成"不超行"，展开，再折——来回振荡。
      const height = element.scrollHeight;
      const lineHeight = Number.parseFloat(getComputedStyle(element).lineHeight);
      if (!height || !Number.isFinite(lineHeight) || lineHeight <= 0) {
        // 量不到（jsdom 没有布局）：退回文本启发式，保证测试确定。
        setMeasure({ text: currentText, overflow: foldCandidate(currentText), lines: countLines(currentText) });
        return;
      }
      const limit = foldLinesOf(element);
      const lines = Math.round(height / lineHeight);
      setMeasure((current) => {
        const overflow = lines > limit + FOLD_SLACK_LINES;
        return current.text === currentText && current.overflow === overflow && current.lines === lines
          ? current
          : { text: currentText, overflow, lines };
      });
    };
    const schedule = () => {
      cancelAnimationFrame(measureFrameRef.current);
      measureFrameRef.current = requestAnimationFrame(evaluate);
    };
    schedule();
    if (typeof ResizeObserver !== 'function') return () => cancelAnimationFrame(measureFrameRef.current);
    // 两处都推到下一帧，原因相同："ResizeObserver loop completed with undelivered
    // notifications" 报的是同一轮投递里又冒出了新通知。回调里直接
    // setState 改高度也会重入布局。所以登记观察和高度测量都延到下一帧。
    let attach = 0;
    const observer = new ResizeObserver(schedule);
    attach = requestAnimationFrame(() => {
      observer.observe(element);
      schedule();
    });
    return () => {
      cancelAnimationFrame(attach);
      cancelAnimationFrame(measureFrameRef.current);
      measureFrameRef.current = 0;
      observer.disconnect();
    };
  }, [needsMeasurement]);

  // DOM 还没量到新文本时，先用同一个确定性启发式：长文第一帧便折起，不等
  // observer 再改高度。量完后仍以真实布局为准。
  const canFold = (measure.text === text ? measure.overflow : foldCandidate(text)) === true;
  const folded = canFold && (expanded === false || (expanded !== true && !exempt));
  // 按钮上报的行数用源文本的行数：人贴了 40 行就说 40 行。渲染行数（段落间距、
  // 表格、代码块都算进去）只在没有源文本时兜底。
  const sourceLines = text ? countLines(String(text)) : 0;
  const reportedLines = sourceLines > 1 ? sourceLines : measure.lines;

  // Pin the control visually as soon as the folded DOM commits. Virtuoso will
  // reconcile the changed item height in its ResizeObserver delivery; until
  // that happens a transform keeps the exact point the reader clicked still.
  useLayoutEffect(() => {
    const anchor = foldAnchorRef.current;
    const button = toggleRef.current;
    if (!folded || !anchor || !button) return;
    // An item close to the bottom can make the old scrollTop invalid as soon
    // as it folds. Clamp explicitly before measuring; otherwise the browser's
    // implicit clamp moves the visually pinned control a few pixels later.
    const maximum = Math.max(0, anchor.scroller.scrollHeight - anchor.scroller.clientHeight);
    if (anchor.scroller.scrollTop > maximum) anchor.scroller.scrollTop = maximum;
    anchor.pin();
  }, [folded]);

  useLayoutEffect(() => () => {
    foldObserverRef.current?.disconnect();
    foldAnchorRef.current?.cleanup?.();
  }, []);

  const toggle = useCallback(() => {
    if (folded) onToggle?.(id, true);
    else {
      const button = toggleRef.current;
      const scroller = button ? scrollParentOf(button) : null;
      const anchorTop = button?.getBoundingClientRect().top;
      const pin = () => {
        const current = toggleRef.current;
        if (!current?.isConnected) return;
        current.style.transform = '';
        const delta = anchorTop - current.getBoundingClientRect().top;
        if (delta) current.style.transform = `translateY(${delta}px)`;
      };
      const handleScroll = () => pin();
      // Virtuoso owns item-height bookkeeping. When a long item shrinks it first
      // adjusts the virtual-list anchor; correcting in a layout effect races that
      // bookkeeping and produces two visible jumps. Observe the toggle itself
      // instead: its label changes size in the same resize delivery, after
      // Virtuoso has settled the item, then restore the point the reader clicked.
      const observer = button && scroller && Number.isFinite(anchorTop) && typeof ResizeObserver === 'function'
        ? new ResizeObserver(() => {
          observer.disconnect();
          foldObserverRef.current = null;
          foldAnchorRef.current?.cleanup?.();
          const current = toggleRef.current;
          if (!current?.isConnected) {
            foldAnchorRef.current = null;
            return;
          }
          // Read the layout position without the temporary visual pin, move the
          // scroller once, then remove the pin. These mutations share one resize
          // delivery, so no intermediate position reaches the screen.
          current.style.transform = '';
          const delta = current.getBoundingClientRect().top - anchorTop;
          if (delta) scroller.scrollTop += delta;
          foldAnchorRef.current = null;
        })
        : null;
      foldAnchorRef.current?.cleanup?.();
      foldObserverRef.current = observer;
      foldAnchorRef.current = observer
        ? { top: anchorTop, scroller, pin, cleanup: () => scroller.removeEventListener('scroll', handleScroll) }
        : null;
      if (observer) scroller.addEventListener('scroll', handleScroll, { passive: true });
      observer?.observe(button);
      onToggle?.(id, false);
    }
  }, [folded, id, onToggle]);

  return <div className={`message-fold${folded ? ' is-folded' : ''} ${className}`.trim()}>
    <div ref={contentRef} className="message-fold-content">{children}</div>
    {canFold && <button ref={toggleRef} type="button" className="message-fold-toggle" aria-expanded={!folded} onClick={toggle}>
      <span aria-hidden="true">⌄</span>
      {folded ? `展开全文 · ${reportedLines} 行` : '收起'}
    </button>}
  </div>;
}
