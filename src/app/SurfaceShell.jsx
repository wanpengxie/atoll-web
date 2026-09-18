import React, { forwardRef, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';

const MOBILE_QUERY = '(max-width: 640px)';
const COMPACT_QUERY = '(max-width: 900px)';

function readTopology() {
  if (globalThis.matchMedia?.(MOBILE_QUERY).matches) return 'mobile';
  if (globalThis.matchMedia?.(COMPACT_QUERY).matches) return 'compact';
  return 'desktop';
}

export function useSurfaceTopology() {
  const [topology, setTopology] = useState(readTopology);
  useEffect(() => {
    const mobile = globalThis.matchMedia?.(MOBILE_QUERY);
    const compact = globalThis.matchMedia?.(COMPACT_QUERY);
    if (!mobile || !compact) return undefined;
    const update = () => setTopology(readTopology());
    update();
    mobile.addEventListener?.('change', update);
    compact.addEventListener?.('change', update);
    return () => {
      mobile.removeEventListener?.('change', update);
      compact.removeEventListener?.('change', update);
    };
  }, []);
  return topology;
}

function publishRef(ref, node) {
  if (typeof ref === 'function') ref(node);
  else if (ref) ref.current = node;
}

function clearVisualViewportFrame(node) {
  node.removeAttribute('data-visual-viewport-owned');
  node.style.removeProperty('--visual-viewport-height');
  node.style.removeProperty('--visual-viewport-width');
  node.style.removeProperty('--visual-viewport-offset-top');
  node.style.removeProperty('--visual-viewport-offset-left');
}

// The Shell owns the breakpoint and emits an explicit topology class. Its host
// identity stays stable across rotation so the Conversation Surface is not
// torn down merely because desktop chrome became mobile chrome.
export const SurfaceShell = forwardRef(function SurfaceShell({ topology = 'desktop', className = '', children, ...props }, ref) {
  const hostRef = useRef(null);
  const setHostRef = useCallback((node) => {
    hostRef.current = node;
    publishRef(ref, node);
  }, [ref]);

  useLayoutEffect(() => {
    const host = hostRef.current;
    const viewport = globalThis.visualViewport;
    if (!host || !viewport?.addEventListener) return undefined;

    // The VisualViewport is the sole keyboard geometry source. Composer
    // content height never enters this calculation. Keep pinch zoom native:
    // at a non-unit scale the browser owns magnification and the shell falls
    // back to its layout viewport instead of counter-scaling the page.
    const commitFrame = () => {
      const scale = Number(viewport.scale || 1);
      if (Math.abs(scale - 1) > 0.01) {
        clearVisualViewportFrame(host);
        return;
      }
      const height = Number(viewport.height);
      const width = Number(viewport.width);
      if (!(height > 0) || !(width > 0)) {
        clearVisualViewportFrame(host);
        return;
      }
      const offsetTop = Number(viewport.offsetTop || 0);
      const offsetLeft = Number(viewport.offsetLeft || 0);
      const layoutHeight = Number(globalThis.innerHeight || 0);
      const layoutWidth = Number(globalThis.innerWidth || 0);
      const visualOnlyFrame = Math.abs(offsetTop) > 0.5
        || Math.abs(offsetLeft) > 0.5
        || (layoutHeight > 0 && height < layoutHeight - 0.5)
        || (layoutWidth > 0 && width < layoutWidth - 0.5);
      if (!visualOnlyFrame) {
        clearVisualViewportFrame(host);
        return;
      }
      host.style.setProperty('--visual-viewport-height', `${height}px`);
      host.style.setProperty('--visual-viewport-width', `${width}px`);
      host.style.setProperty('--visual-viewport-offset-top', `${offsetTop}px`);
      host.style.setProperty('--visual-viewport-offset-left', `${offsetLeft}px`);
      host.setAttribute('data-visual-viewport-owned', 'true');
    };

    commitFrame();
    viewport.addEventListener('resize', commitFrame);
    viewport.addEventListener('scroll', commitFrame);
    globalThis.addEventListener?.('resize', commitFrame);
    return () => {
      viewport.removeEventListener('resize', commitFrame);
      viewport.removeEventListener('scroll', commitFrame);
      globalThis.removeEventListener?.('resize', commitFrame);
      clearVisualViewportFrame(host);
    };
  }, []);

  return <div ref={setHostRef} className={`${className} ${topology}-shell`} data-shell-topology={topology} {...props}>{children}</div>;
});
