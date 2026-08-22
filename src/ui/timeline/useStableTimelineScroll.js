import { useEffect, useLayoutEffect, useRef, useState } from 'react';

function bottomOf(node) {
  return Math.max(0, node.scrollHeight - node.clientHeight);
}

export function useStableTimelineScroll({ channelId, lastSeq, page }) {
  const viewportRef = useRef(null);
  const contentRef = useRef(null);
  const pinnedRef = useRef(true);
  const previousSeqRef = useRef(lastSeq);
  const frameRef = useRef(0);
  const [unseenCount, setUnseenCount] = useState(0);

  function scheduleBottom(force = false) {
    cancelAnimationFrame(frameRef.current);
    frameRef.current = requestAnimationFrame(() => {
      const node = viewportRef.current;
      if (!node || (!force && !pinnedRef.current)) return;
      const target = bottomOf(node);
      if (Math.abs(node.scrollTop - target) > 1) node.scrollTop = target;
    });
  }

  useEffect(() => {
    setUnseenCount(0);
    previousSeqRef.current = lastSeq;
    pinnedRef.current = true;
    scheduleBottom(true);
    return () => cancelAnimationFrame(frameRef.current);
  }, [channelId]);

  useEffect(() => {
    const previous = previousSeqRef.current;
    if (lastSeq > previous && !pinnedRef.current) setUnseenCount((value) => value + Math.max(1, lastSeq - previous));
    previousSeqRef.current = lastSeq;
  }, [lastSeq]);

  useLayoutEffect(() => {
    if (page !== 0 || !pinnedRef.current) return undefined;
    const node = viewportRef.current;
    if (node) {
      const target = bottomOf(node);
      // A progress frame commonly replaces text without changing geometry.
      // Avoid writing the same scrollTop on every frame: repeated no-op writes
      // still interrupt browser momentum/composition painting on some devices.
      if (Math.abs(node.scrollTop - target) > 1) node.scrollTop = target;
    }
    return undefined;
  }, [page, lastSeq]);

  useEffect(() => {
    const content = contentRef.current;
    if (!content || typeof ResizeObserver === 'undefined') return undefined;
    const observer = new ResizeObserver(() => {
      if (page === 0 && pinnedRef.current) scheduleBottom();
    });
    observer.observe(content);
    return () => {
      observer.disconnect();
      cancelAnimationFrame(frameRef.current);
    };
  }, [page, channelId]);

  function observeScroll(event) {
    const node = event.currentTarget;
    pinnedRef.current = bottomOf(node) - node.scrollTop < 80;
    if (pinnedRef.current) setUnseenCount(0);
  }

  function jumpToLatest() {
    setUnseenCount(0);
    pinnedRef.current = true;
    scheduleBottom(true);
  }

  function leaveLatest() {
    pinnedRef.current = false;
  }

  return { viewportRef, contentRef, unseenCount, observeScroll, jumpToLatest, leaveLatest };
}
