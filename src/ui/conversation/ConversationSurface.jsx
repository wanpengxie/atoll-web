import React, { useLayoutEffect, useRef, useState } from 'react';
import { ComposerPresentationProvider } from './ComposerPresentationContext.jsx';

function renderedHeight(node) {
  const height = Math.ceil(node?.getBoundingClientRect?.().height || 0);
  return Number.isFinite(height) && height > 0 ? height : null;
}

function nonNegativeHeight(node) {
  const height = Math.ceil(node?.getBoundingClientRect?.().height || 0);
  return Number.isFinite(height) && height >= 0 ? height : 0;
}

function cssPixels(node, name, fallback) {
  const value = Number.parseFloat(globalThis.getComputedStyle?.(node)?.getPropertyValue(name));
  return Number.isFinite(value) && value >= 0 ? value : fallback;
}

/**
 * Owns the one permitted geometric relationship between the reading viewport
 * and the input stack. Only user-authored input growth is measured here. The
 * waiting/task layer is a floating sibling, so backend state can never resize
 * the reading viewport or the composer.
 */
export function ConversationSurface({ children, input, floating = null, className = '' }) {
  const surfaceRef = useRef(null);
  const readingRef = useRef(null);
  const inputRef = useRef(null);
  const inputMeasureRef = useRef(null);
  const prepareSendClearRef = useRef(() => false);
  const composerPresentationRef = useRef(null);
  if (!composerPresentationRef.current) {
    composerPresentationRef.current = Object.freeze({
      prepareSendClear(revision) {
        return prepareSendClearRef.current(revision);
      },
    });
  }
  const sendClearTransitionRef = useRef({
    revision: '',
    paintedHeight: 0,
    preparedRevision: '',
    preparedHeight: 0,
    paintFrame: 0,
    transitionFrame: 0,
    active: false,
  });
  const [geometry, setGeometry] = useState({
    inputMaxHeight: null,
    constrained: false,
    compact: false,
  });

  useLayoutEffect(() => {
    const surface = surfaceRef.current;
    const inputSlot = inputMeasureRef.current;
    if (!surface || !inputSlot) return undefined;
    const transition = sendClearTransitionRef.current;
    const composerWrap = () => inputSlot.querySelector('.composer-wrap');
    const naturalInputHeight = () => nonNegativeHeight(composerWrap()) || nonNegativeHeight(inputSlot);
    const clearTransitionStyle = () => {
      inputSlot.removeAttribute('data-send-clear-transition');
      inputSlot.style.removeProperty('--send-clear-from-height');
      inputSlot.style.removeProperty('--send-clear-to-height');
    };
    const finishSendClearTransition = () => {
      if (transition.transitionFrame) cancelAnimationFrame(transition.transitionFrame);
      if (transition.paintFrame) cancelAnimationFrame(transition.paintFrame);
      transition.transitionFrame = 0;
      transition.paintFrame = 0;
      transition.active = false;
      transition.preparedRevision = '';
      transition.preparedHeight = 0;
      clearTransitionStyle();
      transition.paintedHeight = naturalInputHeight();
    };
    const startSendClearTransition = (from, to) => {
      if (!(from > to + 0.5)
        || globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true) {
        // A synchronous prepare may already own an explicit block-size. If
        // the committed editor did not shrink (or motion was disabled before
        // this commit), there will be no transitionend to release it.
        finishSendClearTransition();
        return;
      }
      if (transition.transitionFrame) cancelAnimationFrame(transition.transitionFrame);
      transition.active = true;
      inputSlot.style.setProperty('--send-clear-from-height', `${from}px`);
      inputSlot.style.setProperty('--send-clear-to-height', `${to}px`);
      inputSlot.setAttribute('data-send-clear-transition', 'armed');
      // Install the pre-clear geometry in this layout turn, then let the next
      // paint start the sole CSS-owned spatial transition to the real input
      // height. No scroll method participates in this presentation.
      inputSlot.getBoundingClientRect();
      transition.transitionFrame = requestAnimationFrame(() => {
        transition.transitionFrame = 0;
        if (!transition.active) return;
        inputSlot.setAttribute('data-send-clear-transition', 'running');
      });
    };
    prepareSendClearRef.current = (revision) => {
      const preparedRevision = String(revision ?? '');
      if (!preparedRevision
        || globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true) return false;
      if (transition.active) finishSendClearTransition();
      const from = nonNegativeHeight(inputSlot);
      if (!(from > 0)) return false;
      transition.transitionFrame = 0;
      transition.active = true;
      transition.preparedRevision = preparedRevision;
      transition.preparedHeight = from;
      transition.paintedHeight = from;
      inputSlot.style.setProperty('--send-clear-from-height', `${from}px`);
      inputSlot.style.setProperty('--send-clear-to-height', `${from}px`);
      inputSlot.setAttribute('data-send-clear-transition', 'prepared');
      return true;
    };
    const commit = () => {
      const surfaceHeight = renderedHeight(surface);
      const rendered = renderedHeight(inputSlot);
      if (surfaceHeight == null || rendered == null) return;
      const revision = composerWrap()?.dataset.sendClearRevision || '0';
      const targetNaturalHeight = naturalInputHeight();
      if (!transition.revision) {
        transition.revision = revision;
        transition.paintedHeight = targetNaturalHeight;
      } else if (revision !== transition.revision) {
        const from = transition.preparedRevision === revision
          ? transition.preparedHeight
          : transition.paintedHeight || rendered;
        transition.revision = revision;
        transition.preparedRevision = '';
        transition.preparedHeight = 0;
        startSendClearTransition(from, targetNaturalHeight);
      }
      if (!transition.active) {
        if (transition.paintFrame) cancelAnimationFrame(transition.paintFrame);
        transition.paintFrame = requestAnimationFrame(() => {
          transition.paintFrame = 0;
          if (!transition.active) transition.paintedHeight = naturalInputHeight();
        });
      }
      const gap = cssPixels(surface, '--conversation-reading-gap', 32);
      const minimumReading = cssPixels(surface, '--conversation-min-reading-height', 192);
      const minimumInput = cssPixels(surface, '--conversation-min-input-height', 96);
      const inputMaxHeight = Math.max(minimumInput, Math.floor(surfaceHeight - gap - minimumReading));
      // Measure only the in-flow input contract. Waiting is an absolutely
      // positioned sibling; the list owns a fixed reserve from first mount,
      // so task lifecycle changes never enter this geometry transaction.
      const naturalHeight = Math.max(rendered, inputSlot.scrollHeight || 0);
      const next = {
        inputMaxHeight,
        constrained: naturalHeight > inputMaxHeight + 0.5,
        compact: surfaceHeight < minimumReading + gap + minimumInput,
      };
      setGeometry((current) => (
        current.inputMaxHeight === next.inputMaxHeight
        && current.constrained === next.constrained
        && current.compact === next.compact
          ? current
          : next
      ));
    };
    commit();
    const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(commit) : null;
    observer?.observe(surface);
    observer?.observe(inputSlot);
    const inputMutationObserver = typeof MutationObserver === 'function'
      ? new MutationObserver(commit)
      : null;
    inputMutationObserver?.observe(inputSlot, {
      attributes: true,
      subtree: true,
      attributeFilter: ['data-send-clear-revision'],
    });
    const onTransitionComplete = (event) => {
      if (event.target !== inputSlot
        || !['block-size', 'height'].includes(event.propertyName)
        || !transition.active) return;
      finishSendClearTransition();
    };
    const takePresentationControl = (event) => {
      if (event.isTrusted && transition.active) finishSendClearTransition();
    };
    inputSlot.addEventListener('transitionend', onTransitionComplete);
    inputSlot.addEventListener('transitioncancel', onTransitionComplete);
    for (const type of ['wheel', 'pointerdown', 'touchstart', 'beforeinput', 'keydown']) {
      surface.addEventListener(type, takePresentationControl, { capture: true, passive: true });
    }
    return () => {
      prepareSendClearRef.current = () => false;
      observer?.disconnect();
      inputMutationObserver?.disconnect();
      inputSlot.removeEventListener('transitionend', onTransitionComplete);
      inputSlot.removeEventListener('transitioncancel', onTransitionComplete);
      for (const type of ['wheel', 'pointerdown', 'touchstart', 'beforeinput', 'keydown']) {
        surface.removeEventListener(type, takePresentationControl, { capture: true });
      }
      if (transition.paintFrame) cancelAnimationFrame(transition.paintFrame);
      finishSendClearTransition();
    };
  }, []);

  const surfaceClass = [
    'conversation-surface',
    geometry.constrained ? 'is-input-constrained' : '',
    geometry.compact ? 'is-compact-height' : '',
    className,
  ].filter(Boolean).join(' ');
  const style = geometry.inputMaxHeight == null ? undefined : {
    '--conversation-input-max-height': `${geometry.inputMaxHeight}px`,
  };

  return <ComposerPresentationProvider value={composerPresentationRef.current}><div
    ref={surfaceRef}
    className={surfaceClass}
    style={style}
  >
    <div ref={readingRef} className="conversation-reading-slot">{children}</div>
    <div ref={inputRef} className="conversation-bottom-stack">
      <div className="conversation-floating-slot">{floating}</div>
      <div ref={inputMeasureRef} className="conversation-input-slot">{input}</div>
    </div>
  </div></ComposerPresentationProvider>;
}
