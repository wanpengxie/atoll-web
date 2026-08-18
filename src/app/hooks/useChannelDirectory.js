import { useCallback, useEffect, useMemo, useState } from 'react';
import { CHANNEL_ACCESS } from '../../model/channel-access.js';

export function useChannelDirectory({ accessRef, channelStatesRef, cursorsRef, rosterRef, onChannelChanged, onNotice }) {
  const [channels, setChannels] = useState(new Map());
  const [version, setVersion] = useState(0);
  const [activeChannelId, setActiveChannelId] = useState('');
  const rows = useMemo(() => (accessRef.current?.rows() || []).sort((left, right) => {
    if (left.id === 'c0') return -1;
    if (right.id === 'c0') return 1;
    return (left.qualified_name || left.name || left.id).localeCompare(right.qualified_name || right.name || right.id);
  }), [accessRef, version]);

  useEffect(() => {
    if (!activeChannelId && rows.length) {
      const initial = rows.find((channel) => channel.access === CHANNEL_ACCESS.memberActive);
      setActiveChannelId(initial?.id || rows[0].id);
    } else if (activeChannelId && !rows.some((channel) => channel.id === activeChannelId)) {
      if (accessRef.current?.state(activeChannelId)?.existence === 'retired') onNotice(`${activeChannelId} 已退役，已切换到其他可用频道。`);
      const next = rows.find((channel) => channel.access === CHANNEL_ACCESS.memberActive) || rows[0];
      setActiveChannelId(next?.id || '');
    }
  }, [accessRef, activeChannelId, onNotice, rows]);

  const select = useCallback((channelId) => {
    setActiveChannelId(channelId);
    const lastSeq = channelStatesRef.current.get(channelId)?.lastSeq || 0;
    cursorsRef.current.markRead(channelId, lastSeq);
    onChannelChanged();
  }, [channelStatesRef, cursorsRef, onChannelChanged]);
  const bump = useCallback(() => setVersion((value) => value + 1), []);
  const clear = useCallback(() => { setChannels(new Map()); setActiveChannelId(''); }, []);

  return { channels, setChannels, rows, version, bump, activeChannelId, setActiveChannelId, select, clear, selfFor: (channelId) => rosterRef.current?.self(channelId) || '' };
}
