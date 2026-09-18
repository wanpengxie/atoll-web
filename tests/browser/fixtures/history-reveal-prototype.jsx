import React, { useCallback, useLayoutEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { Virtuoso } from 'react-virtuoso';

const STATUS_HEIGHT = 44;
const DURATION_MS = 280;
const MAX_FOREGROUND_UNITS = 24;

document.body.style.cssText = 'margin:0;background:#f7f3ea;color:#29241d;font:14px/1.45 system-ui,sans-serif';

const styles = `
  * { box-sizing: border-box; }
  .history-prototype-root { width: 760px; height: 600px; margin: 0 auto; overflow: auto; overscroll-behavior: contain; background: #fffdf8; }
  .history-reveal-prefix { position: relative; width: 100%; overflow: clip; border-bottom: 1px solid #ded7ca; background: #f7f3ea; }
  .history-reveal-status { display: flex; height: ${STATUS_HEIGHT}px; align-items: center; justify-content: center; gap: 9px; color: #6c6256; font-size: 12px; }
  .history-reveal-spinner { width: 14px; height: 14px; border: 2px solid #b9ab99; border-right-color: transparent; border-radius: 50%; animation: history-prototype-spin .8s linear infinite; }
  .history-reveal-prefix:not([data-phase="loading"]) .history-reveal-spinner { animation: none; border-right-color: #b9ab99; }
  .history-reveal-clip { overflow: clip; transition-property: block-size; transition-duration: ${DURATION_MS}ms; transition-timing-function: cubic-bezier(.2,.75,.25,1); }
  .history-reveal-clip[data-motion="instant"] { transition-duration: 0ms; }
  .history-reveal-segment { display: flow-root; padding: 0 22px; }
  .history-reveal-row, .history-current-row { min-height: 66px; padding: 10px 14px; border-top: 1px solid #e5ded2; background: #fffdf8; }
  .history-reveal-row strong, .history-current-row strong { display: block; color: #574f45; }
  .history-reveal-row p, .history-current-row p { margin: 4px 0 0; }
  .history-current-row { margin: 0 22px; }
  .history-prototype-error { color: #9c3b32; }
  @keyframes history-prototype-spin { to { rotate: 1turn; } }
  @media (prefers-reduced-motion: reduce) {
    .history-reveal-spinner, .history-reveal-clip { animation: none; transition-duration: 0ms; }
  }
`;

let unitSerial = 0;
function makeUnits(count, label = 'batch') {
  return Array.from({ length: count }, (_, index) => ({
    id: `${label}-${++unitSerial}`,
    text: `${label} 历史消息 ${index + 1}：这是完整 conversation unit，不在动画中拆分。`,
  }));
}

function HistoryRevealTransition({ activation, reducedMotion, expose }) {
  const [committed, setCommitted] = useState([]);
  const [active, setActive] = useState(null);
  const [status, setStatus] = useState('loading');
  const [offDOMCount, setOffDOMCount] = useState(0);
  const activeRef = useRef(active);
  const committedRef = useRef(committed);
  const queueRef = useRef([]);
  const committingRef = useRef(new Set());
  const clipRef = useRef(null);
  const contentRef = useRef(null);
  const frameRef = useRef([]);
  activeRef.current = active;
  committedRef.current = committed;

  const admitNext = useCallback(() => {
    if (activeRef.current || !queueRef.current.length) return;
    const units = queueRef.current.shift();
    setStatus('prepared');
    setActive({ id: `segment-${units[0]?.id || 'empty'}`, units, phase: 'measuring', target: 0, height: 0, instant: reducedMotion });
  }, [reducedMotion]);

  const commitActive = useCallback(() => {
    const current = activeRef.current;
    if (!current || committingRef.current.has(current.id)) return;
    committingRef.current.add(current.id);
    setCommitted((rows) => [...rows, ...current.units]);
    setActive(null);
    setStatus('committed');
  }, []);

  const enqueue = useCallback((incoming) => {
    setStatus('prepared');
    const occupied = committedRef.current.length
      + (activeRef.current?.units.length || 0)
      + queueRef.current.reduce((total, units) => total + units.length, 0);
    const admitted = incoming.slice(0, Math.max(0, MAX_FOREGROUND_UNITS - occupied));
    const deferred = incoming.length - admitted.length;
    if (deferred) setOffDOMCount((count) => count + deferred);
    if (!admitted.length) return;
    const current = activeRef.current;
    if (current?.phase === 'measuring') {
      setActive({ ...current, units: [...current.units, ...admitted] });
      return;
    }
    queueRef.current.push(admitted);
    requestAnimationFrame(admitNext);
  }, [admitNext]);

  const cancelForInput = useCallback(() => {
    const current = activeRef.current;
    const clip = clipRef.current;
    if (!current || current.phase !== 'revealing' || !clip) return;
    const height = clip.getBoundingClientRect().height;
    setActive({ ...current, phase: 'settling', height, instant: true });
    requestAnimationFrame(() => {
      const latest = activeRef.current;
      if (!latest) return;
      setActive({ ...latest, phase: 'revealing', height: latest.target, instant: true });
      requestAnimationFrame(commitActive);
    });
  }, [commitActive]);

  useLayoutEffect(() => {
    if (active?.phase !== 'measuring' || !contentRef.current) return undefined;
    const token = active.id;
    const publish = () => {
      const target = contentRef.current?.scrollHeight || 0;
      if (!target) return;
      requestAnimationFrame(() => setActive((current) => current?.id === token
        ? { ...current, phase: 'revealing', target, height: target, instant: reducedMotion }
        : current));
    };
    const observer = new ResizeObserver(publish);
    observer.observe(contentRef.current);
    publish();
    return () => observer.disconnect();
  }, [active?.id, active?.phase, active?.units.length, reducedMotion]);

  useLayoutEffect(() => {
    if (active?.phase !== 'revealing' || !active.instant) return undefined;
    const frame = requestAnimationFrame(commitActive);
    return () => cancelAnimationFrame(frame);
  }, [active?.instant, active?.phase, commitActive]);

  useLayoutEffect(() => {
    if (active || !queueRef.current.length) return undefined;
    const frame = requestAnimationFrame(admitNext);
    return () => cancelAnimationFrame(frame);
  }, [active, admitNext, committed.length]);

  useLayoutEffect(() => {
    setCommitted([]);
    setActive(null);
    setStatus('loading');
    setOffDOMCount(0);
    queueRef.current = [];
    committingRef.current.clear();
  }, [activation]);

  useLayoutEffect(() => {
    expose.current = {
      enqueue,
      cancelForInput,
      error() { if (!activeRef.current) setStatus('error'); },
      eof() { if (!activeRef.current) setStatus('eof'); },
      loading() { if (!activeRef.current) setStatus('loading'); },
      snapshot() {
        const prefix = document.querySelector('.history-reveal-prefix');
        const statusNode = document.querySelector('.history-reveal-status');
        const clip = clipRef.current;
        return {
          activation, status, phase: activeRef.current?.phase || status,
          committed: committedRef.current.map((row) => row.id),
          active: activeRef.current?.units.map((row) => row.id) || [],
          queued: queueRef.current.flat().map((row) => row.id), offDOMCount,
          prefixHeight: prefix?.getBoundingClientRect().height || 0,
          clipHeight: clip?.getBoundingClientRect().height || 0,
          targetHeight: activeRef.current?.target || 0,
          statusNode, prefix, clip,
        };
      },
      frameRef,
    };
  }, [activation, cancelForInput, enqueue, expose, offDOMCount, status]);

  const label = status === 'loading' ? '正在读取更早动态…'
    : status === 'error' ? '读取失败，点击重试'
      : status === 'eof' ? '已到最早动态'
        : active ? `正在展开 ${active.units.length} 条更早动态` : '更早动态已载入';
  return <section className="history-reveal-prefix" data-phase={active?.phase || status} data-activation={activation}>
    <div className={`history-reveal-status${status === 'error' ? ' history-prototype-error' : ''}`} role={status === 'error' ? 'alert' : 'status'}>
      <span className="history-reveal-spinner" aria-hidden="true" />
      <span>{label}</span>
    </div>
    {committed.length > 0 && <div className="history-reveal-segment" data-segment="committed">
      {committed.map((row) => <article key={row.id} className="history-reveal-row" data-history-unit={row.id}><strong>{row.id}</strong><p>{row.text}</p></article>)}
    </div>}
    {active && <div
      ref={clipRef}
      className="history-reveal-clip"
      data-motion={active.instant ? 'instant' : 'animated'}
      style={{ blockSize: `${active.height}px` }}
      onTransitionEnd={(event) => {
        // Chromium reports the physical property (height) for a logical
        // block-size transition. Accept both spellings, but only from this
        // exact segment and only while its reveal token remains live.
        if (event.target === event.currentTarget
          && (event.propertyName === 'block-size' || event.propertyName === 'height')
          && activeRef.current?.phase === 'revealing') commitActive();
      }}
    ><div ref={contentRef} className="history-reveal-segment" data-segment={active.id}>
      {active.units.map((row) => <article key={row.id} className="history-reveal-row" data-history-unit={row.id}><strong>{row.id}</strong><p>{row.text}</p></article>)}
    </div></div>}
  </section>;
}

const initialRows = Array.from({ length: 100 }, (_, index) => ({ id: `current-${index}`, text: `当前消息 ${index}` }));

function Fixture() {
  const [scrollRoot, setScrollRoot] = useState(null);
  const [rows, setRows] = useState(initialRows);
  const [activation, setActivation] = useState(1);
  const [reducedMotion, setReducedMotion] = useState(false);
  const reveal = useRef(null);
  const rangeRef = useRef([]);
  const scrollRef = useCallback((node) => setScrollRoot((current) => current === node ? current : node), []);
  useLayoutEffect(() => {
    if (!scrollRoot) return undefined;
    const onWheel = (event) => { if (event.isTrusted) reveal.current?.cancelForInput(); };
    scrollRoot.addEventListener('wheel', onWheel, { capture: true, passive: true });
    return () => scrollRoot.removeEventListener('wheel', onWheel, { capture: true });
  }, [scrollRoot]);
  useLayoutEffect(() => {
    window.historyRevealPrototype = {
      deliver(count = 4, label = 'batch') { reveal.current?.enqueue(makeUnits(count, label)); },
      error() { reveal.current?.error(); },
      eof() { reveal.current?.eof(); },
      loading() { reveal.current?.loading(); },
      setReduced(value) { setReducedMotion(Boolean(value)); },
      switchActivation() { setActivation((value) => value + 1); },
      appendBackground() { setRows((current) => [...current, { id: `background-${current.length}`, text: '普通后台更新' }]); },
      snapshot() {
        const current = reveal.current?.snapshot() || {};
        return {
          ...current,
          statusNode: undefined, prefix: undefined, clip: undefined, frameRef: undefined,
          scrollTop: scrollRoot?.scrollTop || 0,
          scrollHeight: scrollRoot?.scrollHeight || 0,
          clientHeight: scrollRoot?.clientHeight || 0,
          range: rangeRef.current.at(-1) || null,
          renderedUnits: document.querySelectorAll('[data-history-unit]').length,
        };
      },
      scrollMiddle() { if (scrollRoot) scrollRoot.scrollTop = Math.max(0, scrollRoot.scrollHeight / 2); },
      root: () => scrollRoot,
    };
  }, [scrollRoot]);
  return <>
    <style>{styles}</style>
    <div ref={scrollRef} className="history-prototype-root" data-testid="history-prototype-root">
      <HistoryRevealTransition activation={activation} reducedMotion={reducedMotion} expose={reveal} />
      {scrollRoot && <Virtuoso
        customScrollParent={scrollRoot}
        data={rows}
        computeItemKey={(_index, row) => row.id}
        rangeChanged={(range) => rangeRef.current.push({ ...range, at: performance.now() })}
        itemContent={(_index, row) => <article className="history-current-row" data-current-row={row.id}><strong>{row.id}</strong><p>{row.text}</p></article>}
      />}
    </div>
  </>;
}

flushSync(() => createRoot(document.getElementById('root')).render(<Fixture />));
