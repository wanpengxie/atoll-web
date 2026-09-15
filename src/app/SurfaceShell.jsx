import React, { forwardRef, useEffect, useState } from 'react';

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

// The Shell owns the breakpoint and emits an explicit topology class. Its host
// identity stays stable across rotation so the Conversation Surface is not
// torn down merely because desktop chrome became mobile chrome.
export const SurfaceShell = forwardRef(function SurfaceShell({ topology = 'desktop', className = '', children, ...props }, ref) {
  return <div ref={ref} className={`${className} ${topology}-shell`} data-shell-topology={topology} {...props}>{children}</div>;
});
