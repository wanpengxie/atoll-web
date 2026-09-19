import React, { useEffect } from 'react';
import { VendorListExecutor } from './VendorListExecutor.jsx';

/**
 * Paint-only handoff boundary.
 *
 * Reading mode and position live in the reading-session owner. The one list
 * executor consumes that snapshot for both following and browsing, so this
 * boundary never mirrors mode, bookmark, navigation or history state.
 */
export function ReadingContainerHandoff({ reading, surfaceVisible, ...props }) {
  useEffect(() => {
    reading.onSurfaceVisibilityChange?.(surfaceVisible === true);
  }, [reading, surfaceVisible]);

  return <div
    className="timeline-reading-stack"
    data-reading-mode={reading.session.mode}
    data-reading-activation={reading.activationID}
  >
    <div className="timeline-reading-layer is-active">
      <VendorListExecutor
        {...props}
        reading={reading}
        surfaceVisible={surfaceVisible}
      />
    </div>
  </div>;
}
