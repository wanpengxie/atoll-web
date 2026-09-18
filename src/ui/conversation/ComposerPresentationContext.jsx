import React, { createContext, useContext } from 'react';

const ComposerPresentationContext = createContext(null);

export function ComposerPresentationProvider({ value, children }) {
  return <ComposerPresentationContext.Provider value={value}>{children}</ComposerPresentationContext.Provider>;
}

export function useComposerPresentation() {
  return useContext(ComposerPresentationContext);
}
