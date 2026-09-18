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
  const inputResizeTransitionRef = useRef({
    paintedHeight: 0,
    targetHeight: 0,
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
    const inputResize = inputResizeTransitionRef.current;
    const composerWrap = () => inputSlot.querySelector('.composer-wrap');
    const naturalInputHeight = () => nonNegativeHeight(composerWrap()) || nonNegativeHeight(inputSlot);
    const presentedInputHeight = () => {
      const natural = naturalInputHeight();
      const maximum = Number.parseFloat(getComputedStyle(inputSlot).maxHeight);
      return Number.isFinite(maximum) ? Math.min(natural, maximum) : natural;
    };
    const clearInputResizeStyle = () => {
      inputSlot.removeAttribute('data-input-resize-transition');
      inputSlot.style.removeProperty('--input-resize-from-height');
      inputSlot.style.removeProperty('--input-resize-to-height');
      surface.removeAttribute('data-input-resize-transition');
      surface.removeAttribute('data-input-resize-growth');
      surface.style.removeProperty('--input-resize-delta-height');
      surface.style.removeProperty('--input-resize-progress-height');
      surface.style.removeProperty('--input-resize-spacer-from-height');
      surface.style.removeProperty('--input-resize-spacer-to-height');
    };
    const finishInputResizeTransition = () => {
      if (inputResize.transitionFrame) cancelAnimationFrame(inputResize.transitionFrame);
      if (inputResize.paintFrame) cancelAnimationFrame(inputResize.paintFrame);
      inputResize.transitionFrame = 0;
      inputResize.paintFrame = 0;
      inputResize.active = false;
      inputResize.targetHeight = 0;
      clearInputResizeStyle();
      inputResize.paintedHeight = nonNegativeHeight(inputSlot);
    };
    const takeInputResizeForSend = () => {
      const rendered = nonNegativeHeight(inputSlot);
      if (inputResize.transitionFrame) cancelAnimationFrame(inputResize.transitionFrame);
      if (inputResize.paintFrame) cancelAnimationFrame(inputResize.paintFrame);
      inputResize.transitionFrame = 0;
      inputResize.paintFrame = 0;
      inputResize.active = false;
      inputResize.targetHeight = 0;
      clearInputResizeStyle();
      inputResize.paintedHeight = rendered;
      return rendered;
    };
    const armInputResizeTransition = () => {
      if (inputResize.transitionFrame) cancelAnimationFrame(inputResize.transitionFrame);
      inputResize.transitionFrame = 0;
      inputSlot.setAttribute('data-input-resize-transition', 'armed');
      surface.setAttribute('data-input-resize-transition', 'armed');
      inputSlot.getBoundingClientRect();
      inputResize.transitionFrame = requestAnimationFrame(() => {
        inputResize.transitionFrame = 0;
        if (!inputResize.active) return;
        surface.style.removeProperty('--input-resize-progress-height');
        inputSlot.setAttribute('data-input-resize-transition', 'running');
        surface.setAttribute('data-input-resize-transition', 'running');
      });
    };
    const startInputResizeTransition = (from, to) => {
      if (globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true
        || !(Math.abs(from - to) > 0.5)) {
        finishInputResizeTransition();
        return;
      }
      if (inputResize.transitionFrame) cancelAnimationFrame(inputResize.transitionFrame);
      if (inputResize.paintFrame) cancelAnimationFrame(inputResize.paintFrame);
      inputResize.transitionFrame = 0;
      inputResize.paintFrame = 0;
      inputResize.active = true;
      inputResize.targetHeight = to;
      inputResize.paintedHeight = from;
      inputSlot.style.setProperty('--input-resize-from-height', `${from}px`);
      inputSlot.style.setProperty('--input-resize-to-height', `${to}px`);
      // Growth would otherwise make the viewport observer issue one bottom
      // write per animation frame. Install the total delta as a temporary
      // tail spacer before the first write and consume it while the viewport
      // shrinks. scrollHeight - clientHeight therefore stays constant after
      // that single authorized write; deletion needs no spacer because the
      // browser's native max-scroll clamp follows the growing viewport.
      const spacer = Math.max(0, to - from);
      surface.style.setProperty('--input-resize-delta-height', `${to - from}px`);
      surface.style.setProperty('--input-resize-progress-height', '0px');
      surface.style.setProperty('--input-resize-spacer-from-height', `${spacer}px`);
      surface.style.setProperty('--input-resize-spacer-to-height', '0px');
      if (spacer > 0) surface.setAttribute('data-input-resize-growth', 'true');
      else surface.removeAttribute('data-input-resize-growth');
      inputSlot.setAttribute('data-input-resize-transition', 'prepared');
      surface.setAttribute('data-input-resize-transition', 'prepared');
      // FLIP the already-laid-out editor back to its last painted block size
      // before this render opportunity, then let CSS interpolate the one
      // in-flow geometry owner. The list keeps using its existing viewport
      // authorization and sole scroll writer throughout the interpolation.
      const scroller = surface.querySelector('.timeline-message-list');
      if (!(spacer > 0)
        || surface.querySelector('.timeline')?.dataset.viewportMode !== 'following'
        || !scroller) {
        armInputResizeTransition();
        return;
      }
      // The temporary spacer changes scrollHeight, not the scroller's border
      // box, so its ResizeObserver cannot authorize the initial write. Publish
      // the prepared geometry to the same adapter authority explicitly. Its
      // synchronous before-write handshake arms the equal visual transform;
      // the adapter remains the sole scroll writer.
      scroller.getBoundingClientRect();
      scroller.dispatchEvent(new CustomEvent('atoll:input-resize-prepared'));
      if (inputSlot.dataset.inputResizeTransition === 'armed') return;
      surface.style.setProperty('--input-resize-spacer-from-height', '0px');
      armInputResizeTransition();
    };
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
      inputResize.paintedHeight = nonNegativeHeight(inputSlot);
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
      const from = inputResize.active ? takeInputResizeForSend() : nonNegativeHeight(inputSlot);
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
      if (!inputResize.paintedHeight) inputResize.paintedHeight = rendered;
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
      if (!transition.active && !inputResize.active) {
        if (inputResize.paintFrame) cancelAnimationFrame(inputResize.paintFrame);
        inputResize.paintFrame = requestAnimationFrame(() => {
          inputResize.paintFrame = 0;
          if (!inputResize.active && !transition.active) {
            inputResize.paintedHeight = nonNegativeHeight(inputSlot);
          }
        });
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
    const animateInputMutation = () => {
      if (transition.active) return;
      // ProseMirror publishes its final DOM after the native input event. A
      // subtree mutation is therefore the last pre-paint boundary at which we
      // can read the new natural height without writing from ResizeObserver.
      const target = presentedInputHeight();
      if (inputResize.active && Math.abs(inputResize.targetHeight - target) <= 0.5) return;
      const from = inputResize.active
        ? nonNegativeHeight(inputSlot)
        : inputResize.paintedHeight || nonNegativeHeight(inputSlot);
      if (Math.abs(from - target) > 0.5) startInputResizeTransition(from, target);
    };
    const inputMutationObserver = typeof MutationObserver === 'function'
      ? new MutationObserver((records) => {
        if (records.some((record) => record.type === 'attributes')) commit();
        if (records.some((record) => record.type === 'characterData' || record.type === 'childList')) {
          animateInputMutation();
        }
      })
      : null;
    inputMutationObserver?.observe(inputSlot, {
      attributes: true,
      subtree: true,
      attributeFilter: ['data-send-clear-revision'],
      characterData: true,
      childList: true,
    });
    const onTimelineBottomWrite = (event) => {
      if (!inputResize.active
        || inputSlot.dataset.inputResizeTransition !== 'prepared'
        || !event.target?.classList?.contains('timeline-message-list')) return;
      armInputResizeTransition();
    };
    const onTransitionComplete = (event) => {
      if (event.target === inputSlot
        && ['block-size', 'height'].includes(event.propertyName)
        && transition.active) {
        finishSendClearTransition();
      } else if (event.target === surface
        && event.propertyName === '--input-resize-progress-height'
        && inputResize.active) {
        finishInputResizeTransition();
      }
    };
    const takePresentationControl = (event) => {
      if (event.isTrusted && transition.active) finishSendClearTransition();
    };
    inputSlot.addEventListener('transitionend', onTransitionComplete);
    inputSlot.addEventListener('transitioncancel', onTransitionComplete);
    surface.addEventListener('transitionend', onTransitionComplete);
    surface.addEventListener('transitioncancel', onTransitionComplete);
    surface.addEventListener('atoll:timeline-bottom-write', onTimelineBottomWrite);
    for (const type of ['wheel', 'pointerdown', 'touchstart', 'beforeinput', 'keydown']) {
      surface.addEventListener(type, takePresentationControl, { capture: true, passive: true });
    }
    return () => {
      prepareSendClearRef.current = () => false;
      observer?.disconnect();
      inputMutationObserver?.disconnect();
      inputSlot.removeEventListener('transitionend', onTransitionComplete);
      inputSlot.removeEventListener('transitioncancel', onTransitionComplete);
      surface.removeEventListener('transitionend', onTransitionComplete);
      surface.removeEventListener('transitioncancel', onTransitionComplete);
      surface.removeEventListener('atoll:timeline-bottom-write', onTimelineBottomWrite);
      for (const type of ['wheel', 'pointerdown', 'touchstart', 'beforeinput', 'keydown']) {
        surface.removeEventListener(type, takePresentationControl, { capture: true });
      }
      if (transition.paintFrame) cancelAnimationFrame(transition.paintFrame);
      if (inputResize.paintFrame) cancelAnimationFrame(inputResize.paintFrame);
      finishInputResizeTransition();
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
