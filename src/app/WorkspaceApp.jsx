import React from 'react';

// Current-only application composition. Domain owners are mounted here; the
// deleted legacy App must never become an implementation dependency again.
export function WorkspaceApp() {
  return <div className="boot-screen"><span className="brand-dot" />正在启动工作区…</div>;
}
