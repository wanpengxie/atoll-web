import React, { createContext, useCallback, useContext, useState, useSyncExternalStore } from 'react';

// User-selected geometry belongs to the reading session, not to a DOM row's
// lifetime. This store contains presentation choices only, never task status.
export function createMessageLayoutStore(initial = [], onChange) {
  const values = new Map(initial);
  const listeners = new Map();
  return {
    get: (key, fallback) => values.has(key) ? values.get(key) : fallback,
    subscribe(key, listener) {
      if (!listeners.has(key)) listeners.set(key, new Set());
      listeners.get(key).add(listener);
      return () => {
        const subscriptions = listeners.get(key);
        subscriptions?.delete(listener);
        if (!subscriptions?.size) listeners.delete(key);
      };
    },
    set(key, update, fallback) {
      const previous = values.has(key) ? values.get(key) : fallback;
      const next = typeof update === 'function' ? update(previous) : update;
      if (Object.is(previous, next)) return;
      values.set(key, next);
      onChange?.([...values]);
      listeners.get(key)?.forEach((listener) => listener());
    },
  };
}

const StoreContext = createContext(null);
const RowContext = createContext(null);
export function MessageLayoutProvider({ store, children }) {
  return <StoreContext.Provider value={store}>{children}</StoreContext.Provider>;
}
export function MessageLayoutScope({ rowID, children }) {
  return <RowContext.Provider value={rowID}>{children}</RowContext.Provider>;
}
const noSubscription = () => () => {};

export function useMessageLayoutState(name, initial) {
  const owner = useContext(StoreContext);
  const rowID = useContext(RowContext);
  // Standalone previews and other surfaces retain their own component state.
  const store = rowID == null ? null : owner;
  const key = JSON.stringify([rowID, name]);
  const [fallback, setFallback] = useState(initial);
  const subscribe = useCallback((listener) => store ? store.subscribe(key, listener) : noSubscription(), [store, key]);
  const getSnapshot = useCallback(() => store ? store.get(key, fallback) : fallback, [store, key, fallback]);
  const value = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  const setValue = useCallback((update) => {
    if (store) store.set(key, update, fallback);
    else setFallback(update);
  }, [store, key, fallback]);
  return [value, setValue];
}
