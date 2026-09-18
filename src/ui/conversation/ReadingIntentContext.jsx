import React, { createContext, useContext } from 'react';

const ReadingIntentContext = createContext(null);

export function ReadingIntentProvider({ value, children }) {
  return <ReadingIntentContext.Provider value={value}>{children}</ReadingIntentContext.Provider>;
}

export function useReadingIntent() {
  return useContext(ReadingIntentContext);
}
