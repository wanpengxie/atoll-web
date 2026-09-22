import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { CONVERSATION_SCOPE } from '../../model/conversation-presentation.js';
import { createMessageLayoutStore } from './MessageLayoutState.jsx';

export { CONVERSATION_SCOPE };

function readPreferences(channelId, viewSessions) {
  const stored = viewSessions?.read(channelId) || {};
  return {
    scope: stored.scope || CONVERSATION_SCOPE.mine,
    actorFilter: new Set(stored.actorFilter || []),
    foldOverrides: new Map(stored.foldOverrides || []),
    layoutChoices: stored.layoutChoices,
  };
}

export function useTimelinePreferences({ channelId, viewSessions }) {
  const committedOwnerRef = useRef(null);
  const createSession = (nextChannelId, nextViewSessions) => {
    const initial = readPreferences(nextChannelId, nextViewSessions);
    const owner = Object.freeze({ channelId: nextChannelId, viewSessions: nextViewSessions });
    const write = (change) => {
      if (committedOwnerRef.current !== owner) return false;
      return nextViewSessions?.writeConversation(nextChannelId, change) === true;
    };
    return {
      owner,
      scope: initial.scope,
      actorFilter: initial.actorFilter,
      foldOverrides: initial.foldOverrides,
      messageLayoutStore: createMessageLayoutStore(
        initial.layoutChoices,
        (layoutChoices) => write({ layoutChoices }),
      ),
      write,
    };
  };
  const [session, setSession] = useState(() => createSession(channelId, viewSessions));

  // A channel change must reach render with that channel's own preferences.
  // Synchronising during render makes React restart this render before commit,
  // so there is no frame (or passive effect) in which the previous channel's
  // scope/filter/layout can be observed under the new channel identity.
  if (session.owner.channelId !== channelId || session.owner.viewSessions !== viewSessions) {
    setSession(createSession(channelId, viewSessions));
  }

  if (committedOwnerRef.current === null) committedOwnerRef.current = session.owner;

  useLayoutEffect(() => {
    committedOwnerRef.current = session.owner;
    return () => {
      if (committedOwnerRef.current === session.owner) committedOwnerRef.current = null;
    };
  }, [session.owner]);

  useEffect(() => {
    session.write({
      scope: session.scope,
      actorFilter: [...session.actorFilter],
      foldOverrides: [...session.foldOverrides],
    });
  }, [session]);

  const toggleScope = useCallback(() => {
    setSession((current) => current.owner !== session.owner ? current : ({
      ...current,
      scope: current.scope === CONVERSATION_SCOPE.mine
        ? CONVERSATION_SCOPE.all
        : CONVERSATION_SCOPE.mine,
    }));
  }, [session.owner]);
  const toggleActorFilter = useCallback((actorId) => {
    setSession((current) => {
      if (current.owner !== session.owner) return current;
      const next = new Set(current.actorFilter);
      if (!next.delete(actorId)) next.add(actorId);
      return { ...current, actorFilter: next };
    });
  }, [session.owner]);
  const removeActorFilter = useCallback((actorId) => {
    setSession((current) => {
      if (current.owner !== session.owner || !current.actorFilter.has(actorId)) return current;
      const next = new Set(current.actorFilter);
      next.delete(actorId);
      return { ...current, actorFilter: next };
    });
  }, [session.owner]);
  const toggleFold = useCallback((id, expanded, control) => {
    if (committedOwnerRef.current !== session.owner) return;
    setSession((current) => current.owner !== session.owner ? current : ({
      ...current,
      foldOverrides: new Map(current.foldOverrides).set(id, expanded),
    }));
  }, [session.owner]);

  return {
    scope: session.scope,
    actorFilter: session.actorFilter,
    foldOverrides: session.foldOverrides,
    messageLayoutStore: session.messageLayoutStore,
    toggleScope,
    toggleActorFilter,
    removeActorFilter,
    toggleFold,
  };
}
