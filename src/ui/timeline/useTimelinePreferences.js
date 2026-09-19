import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { CONVERSATION_SCOPE } from '../../model/conversation-presentation.js';
import { createMessageLayoutStore } from './MessageLayoutState.jsx';

export { CONVERSATION_SCOPE };

export function useTimelinePreferences({ channelId, viewSessions }) {
  const initialRef = useRef(null);
  if (!initialRef.current) initialRef.current = viewSessions?.read(channelId) || {};
  const initial = initialRef.current;
  const committedOwnerRef = useRef({ channelId, viewSessions });
  const [scope, setScope] = useState(() => initial.scope || CONVERSATION_SCOPE.mine);
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
    setScope((value) => value === CONVERSATION_SCOPE.mine
      ? CONVERSATION_SCOPE.all
      : CONVERSATION_SCOPE.mine);
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
