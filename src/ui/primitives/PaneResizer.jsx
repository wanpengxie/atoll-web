import React, { useCallback, useRef } from 'react';
import { PANE_KINDS, clampPaneWidth } from '../../model/pane-sizes.js';

// 面板边上的一根竖向分隔条。拖它改宽度，双击复原，聚焦后左右方向键微调。
//
//   kind      pane-sizes 里的一种（rail / context / artifact），决定上下限和步长
//   grows     'right'：把手在面板右边，向右拖变宽（左栏）
//             'left'：把手在面板左边，向左拖变宽（右侧面板）
//   width     当前生效宽度（px）；null 表示用 CSS 默认，此时从 measure() 取起点
//   measure   量出面板此刻的实际宽度，拖动的起点
//   onResize  拖动过程中逐帧回报
//   onCommit  松手时回报最终值；onReset 双击复原
export function PaneResizer({ kind, grows = 'right', width = null, measure, onResize, onCommit, onReset, label }) {
  const dragRef = useRef(null);
  const limits = PANE_KINDS[kind];
  const sign = grows === 'left' ? -1 : 1;
  const viewport = () => (typeof window === 'undefined' ? Number.POSITIVE_INFINITY : window.innerWidth);

  const startWidth = useCallback(() => (width ?? measure?.() ?? limits.min), [width, measure, limits.min]);

  const onPointerDown = useCallback((event) => {
    if (event.button !== 0) return;
    event.preventDefault();
    dragRef.current = { pointerId: event.pointerId, originX: event.clientX, originWidth: startWidth(), last: null };
    event.currentTarget.setPointerCapture?.(event.pointerId);
    event.currentTarget.classList.add('is-dragging');
  }, [startWidth]);

  const onPointerMove = useCallback((event) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const next = clampPaneWidth(kind, drag.originWidth + sign * (event.clientX - drag.originX), viewport());
    if (next === null || next === drag.last) return;
    drag.last = next;
    onResize?.(next);
  }, [kind, sign, onResize]);

  const finish = useCallback((event) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    dragRef.current = null;
    event.currentTarget.releasePointerCapture?.(event.pointerId);
    event.currentTarget.classList.remove('is-dragging');
    if (drag.last !== null) onCommit?.(drag.last);
  }, [onCommit]);

  const onKeyDown = useCallback((event) => {
    let delta = 0;
    if (event.key === 'ArrowLeft') delta = -limits.step * sign;
    else if (event.key === 'ArrowRight') delta = limits.step * sign;
    else if (event.key === 'Home' || event.key === 'End') delta = 0;
    else return;
    event.preventDefault();
    if (event.key === 'Home') { onReset?.(); return; }
    const next = clampPaneWidth(kind, startWidth() + delta, viewport());
    if (next !== null) { onResize?.(next); onCommit?.(next); }
  }, [kind, sign, limits.step, startWidth, onResize, onCommit, onReset]);

  return <div
    role="separator"
    aria-orientation="vertical"
    aria-label={label}
    aria-valuemin={limits.min}
    aria-valuenow={width ?? undefined}
    tabIndex={0}
    className={`pane-resizer pane-resizer-${kind} grows-${grows}`}
    title="拖动调整宽度，双击复原"
    onPointerDown={onPointerDown}
    onPointerMove={onPointerMove}
    onPointerUp={finish}
    onPointerCancel={finish}
    onDoubleClick={() => onReset?.()}
    onKeyDown={onKeyDown}
  />;
}
