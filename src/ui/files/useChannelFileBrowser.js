import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { channelMountRoot, directoryEntries, directoryName, fileListCommand, normalizeDirectory, parentDirectory } from '../../model/channel-files.js';
import { createDirectoryResource, deleteFileResource, fileAddress } from '../../model/resources.js';

const PAGE_SIZE = 100;

export function useChannelFileBrowser({ channel, daemons = [], disabled = false, onResource }) {
  const [daemonId, setDaemonId] = useState(daemons[0]?.id || '');
  const [directory, setDirectory] = useState('');
  const [items, setItems] = useState([]);
  const [next, setNext] = useState('');
  const [status, setStatus] = useState('idle');
  const [error, setError] = useState('');
  const [selectedKey, setSelectedKey] = useState('');
  const requestGeneration = useRef(0);

  const activeDaemon = daemons.find((row) => row.id === daemonId);
  const daemonName = activeDaemon?.name || '';
  const qualifiedChannel = channel?.qualified_name || channel?.id || '';
  const mountRoot = daemonName && qualifiedChannel ? channelMountRoot({ daemonName, qualifiedChannel }) : '';
  const prefix = mountRoot ? `${mountRoot}${normalizeDirectory(directory)}` : '';
  const entries = useMemo(() => directoryEntries(items, prefix), [items, prefix]);
  const selected = entries.find((entry) => entry.key === selectedKey) || null;

  useEffect(() => {
    if (!daemons.some((row) => row.id === daemonId)) setDaemonId(daemons[0]?.id || '');
  }, [daemonId, daemons]);

  const load = useCallback(async ({ append = false, cursor = '' } = {}) => {
    if (!channel?.id || !daemonName || disabled || !onResource) {
      setItems([]); setNext(''); setStatus('ready');
      return;
    }
    const generation = ++requestGeneration.current;
    setStatus(append ? 'loading-more' : 'loading');
    setError('');
    try {
      const page = await onResource(fileListCommand({
        channelId: channel.id, daemonName, qualifiedChannel, directory, cursor, limit: PAGE_SIZE,
      }));
      if (generation !== requestGeneration.current) return;
      const incoming = Array.isArray(page?.items) ? page.items : [];
      setItems((current) => {
        if (!append) return incoming;
        const merged = new Map(current.map((item) => [String(item?.id || item?.resource_id || item?.address || ''), item]));
        for (const item of incoming) merged.set(String(item?.id || item?.resource_id || item?.address || ''), item);
        return [...merged.values()];
      });
      setNext(String(page?.next || ''));
      setStatus('ready');
    } catch (failure) {
      if (generation !== requestGeneration.current) return;
      setStatus('error');
      setError(failure?.message || String(failure));
    }
  }, [channel?.id, daemonName, directory, disabled, onResource, qualifiedChannel]);

  useEffect(() => {
    setItems([]); setNext(''); setSelectedKey('');
    void load();
    return () => { requestGeneration.current += 1; };
  }, [load]);

  const navigate = useCallback((target) => {
    setDirectory(normalizeDirectory(target));
    setSelectedKey('');
  }, []);

  const openDirectory = useCallback((entry) => {
    if (entry?.kind === 'directory') navigate(`${normalizeDirectory(directory)}${entry.directory}`);
  }, [directory, navigate]);

  const refresh = useCallback(() => load(), [load]);
  const loadMore = useCallback(() => next && load({ append: true, cursor: next }), [load, next]);

  const createDirectory = useCallback(async (value) => {
    const name = directoryName(value);
    const address = fileAddress({ daemonName, qualifiedChannel, path: `${normalizeDirectory(directory)}${name}` });
    setStatus('mutating'); setError('');
    try {
      await onResource(createDirectoryResource({ channelId: channel.id, address }));
      await load();
    } catch (failure) {
      setStatus('error'); setError(failure?.message || String(failure));
      throw failure;
    }
  }, [channel?.id, daemonName, directory, load, onResource, qualifiedChannel]);

  const deleteEntry = useCallback(async (entry) => {
    if (!entry?.resourceId) return;
    setStatus('mutating'); setError('');
    try {
      await onResource(deleteFileResource({ channelId: channel.id, resourceId: entry.resourceId }));
      setSelectedKey('');
      await load();
    } catch (failure) {
      setStatus('error'); setError(failure?.message || String(failure));
      throw failure;
    }
  }, [channel?.id, load, onResource]);

  return {
    daemonId, setDaemonId, activeDaemon, daemonName, qualifiedChannel, directory, prefix,
    entries, next, status, error, setError, selected, selectedKey, setSelectedKey,
    navigate, openDirectory, parent: () => navigate(parentDirectory(directory)),
    refresh, loadMore, createDirectory, deleteEntry,
    busy: status === 'loading' || status === 'loading-more' || status === 'mutating',
  };
}
