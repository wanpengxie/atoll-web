import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { TIMELINE_SCOPE } from '../../model/timeline-scope.js';
import { createMessageLayoutStore } from './MessageLayoutState.jsx';

export function useTimelinePreferences({ channelId, viewSessions }) {
  const initialRef = useRef(null);
  if (!initialRef.current) initialRef.current = viewSessions?.read(channelId) || {};
  const initial = initialRef.current;
  const committedOwnerRef = useRef({ channelId, viewSessions });
  const [scope, setScope] = useState(() => initial.scope || TIMELINE_SCOPE.mine);
  const [actorFilter, setActorFilter] = useState(() => new Set(initial.actorFilter || []));
  const [foldOverrides, setFoldOverrides] = useState(() => new Map(initial.foldOverrides || []));

  useLayoutEffect(() => {
    committedOwnerRef.current = { channelId, viewSessions };
  }, [channelId, viewSessions]);

  const writePreferences = useCallback((change) => {
    const owner = committedOwnerRef.current;
    return owner.viewSessions?.writeConversation(owner.channelId, change) === true;
  }, []);

  const messageLayoutStoreRef = useRef(null);
  if (!messageLayoutStoreRef.current) {
    messageLayoutStoreRef.current = createMessageLayoutStore(
      initial.layoutChoices,
      (layoutChoices) => writePreferences({ layoutChoices }),
    );
  }

  useEffect(() => {
    writePreferences({
      scope,
      actorFilter: [...actorFilter],
      foldOverrides: [...foldOverrides],
    });
  }, [actorFilter, channelId, foldOverrides, scope, viewSessions, writePreferences]);

  const toggleScope = useCallback(() => {
    setScope((value) => value === TIMELINE_SCOPE.mine ? TIMELINE_SCOPE.all : TIMELINE_SCOPE.mine);
  }, []);
  const toggleActorFilter = useCallback((actorId) => {
    setActorFilter((current) => {
      const next = new Set(current);
      if (!next.delete(actorId)) next.add(actorId);
      return next;
    });
  }, []);
  const removeActorFilter = useCallback((actorId) => {
    setActorFilter((current) => {
      if (!current.has(actorId)) return current;
      const next = new Set(current);
      next.delete(actorId);
      return next;
    });
  }, []);
  const toggleFold = useCallback((id, expanded) => {
    setFoldOverrides((current) => new Map(current).set(id, expanded));
  }, []);

  return {
    scope,
    actorFilter,
    foldOverrides,
    messageLayoutStore: messageLayoutStoreRef.current,
    toggleScope,
    toggleActorFilter,
    removeActorFilter,
    toggleFold,
  };
}
