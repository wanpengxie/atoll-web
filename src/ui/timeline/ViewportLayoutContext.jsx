import React, { createContext, useContext } from 'react';

const ViewportLayoutContext = createContext(null);

export function ViewportLayoutProvider({ port, children }) {
  return <ViewportLayoutContext.Provider value={port}>{children}</ViewportLayoutContext.Provider>;
}

export function useViewportLayout() {
  return useContext(ViewportLayoutContext);
}
