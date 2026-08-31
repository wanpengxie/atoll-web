import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { availableDefaultStorageDeviceId, directoryEntries, directoryName, fileDirectoryPrefix, fileListCommand, normalizeDirectory, parentDirectory } from '../../model/channel-files.js';
import { createDirectoryResource, deleteFileResource, fileAddress } from '../../model/resources.js';

const PAGE_SIZE = 100;

export function useChannelFileBrowser({ channel, devices = [], disabled = false, onResource }) {
  const defaultDaemonId = availableDefaultStorageDeviceId(channel, devices);
  const [daemonId, setDaemonId] = useState(defaultDaemonId);
  const [directory, setDirectory] = useState('');
  const [items, setItems] = useState([]);
  const [next, setNext] = useState('');
  const [status, setStatus] = useState('idle');
  const [error, setError] = useState('');
  const [selectedKey, setSelectedKey] = useState('');
  const requestGeneration = useRef(0);

  const activeDaemon = devices.find((row) => row.id === daemonId);
  const deviceName = activeDaemon?.name || '';
  const channelName = channel?.qualified_name || channel?.name || '';
  const prefix = deviceName && channelName ? fileDirectoryPrefix({ deviceName, channelName, directory }) : '';
  const locationKey = `${channel?.id || ''}\u0000${daemonId}\u0000${directory}`;
  const locationRef = useRef(locationKey);
  locationRef.current = locationKey;
  const entries = useMemo(() => directoryEntries(items, prefix), [items, prefix]);
  const selected = entries.find((entry) => entry.key === selectedKey) || null;

  useEffect(() => {
    setDaemonId(defaultDaemonId);
  }, [channel?.id, defaultDaemonId]);

  useEffect(() => {
    if (daemonId && !devices.some((row) => row.id === daemonId)) setDaemonId(defaultDaemonId);
  }, [daemonId, devices, defaultDaemonId]);

  useEffect(() => {
    requestGeneration.current += 1;
    setDirectory(''); setItems([]); setNext(''); setSelectedKey('');
  }, [channel?.id, daemonId]);

  const load = useCallback(async ({ append = false, cursor = '', expectedLocation = locationKey } = {}) => {
    if (locationRef.current !== expectedLocation) return false;
    if (!channel?.id || !daemonId || !deviceName || !channelName || disabled || !onResource) {
      setItems([]); setNext(''); setStatus('ready');
      return true;
    }
    const generation = ++requestGeneration.current;
    setStatus(append ? 'loading-more' : 'loading');
    setError('');
    try {
      const page = await onResource(fileListCommand({
        channelId: channel.id, deviceName, channelName, directory, cursor, limit: PAGE_SIZE,
      }));
      if (generation !== requestGeneration.current || locationRef.current !== expectedLocation) return false;
      const incoming = Array.isArray(page?.items) ? page.items : [];
      setItems((current) => {
        if (!append) return incoming;
        const merged = new Map(current.map((item) => [String(item?.id || item?.resource_id || item?.address || ''), item]));
        for (const item of incoming) merged.set(String(item?.id || item?.resource_id || item?.address || ''), item);
        return [...merged.values()];
      });
      setNext(String(page?.next || ''));
      setStatus('ready');
      return true;
    } catch (failure) {
      if (generation !== requestGeneration.current || locationRef.current !== expectedLocation) return false;
      setStatus('error');
      setError(failure?.message || String(failure));
      return false;
    }
  }, [channel?.id, channelName, daemonId, deviceName, directory, disabled, locationKey, onResource]);

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

  const refresh = useCallback(() => load({ expectedLocation: locationKey }), [load, locationKey]);
  const refreshLocation = useCallback((expectedLocation) => load({ expectedLocation }), [load]);
  const isCurrentLocation = useCallback((expectedLocation) => locationRef.current === expectedLocation, []);
  const loadMore = useCallback(() => next && load({ append: true, cursor: next }), [load, next]);

  const createDirectory = useCallback(async (value) => {
    const mutationLocation = locationKey;
    const name = directoryName(value);
    const address = fileAddress({ deviceName, channelName, path: `${normalizeDirectory(directory)}${name}` });
    setStatus('mutating'); setError('');
    try {
      await onResource(createDirectoryResource({ channelId: channel.id, address }));
      await load({ expectedLocation: mutationLocation });
    } catch (failure) {
      if (locationRef.current === mutationLocation) {
        setStatus('error'); setError(failure?.message || String(failure));
      }
      throw failure;
    }
  }, [channel?.id, channelName, deviceName, directory, load, locationKey, onResource]);

  const deleteEntry = useCallback(async (entry) => {
    if (!entry?.resourceId) return;
    const mutationLocation = locationKey;
    setStatus('mutating'); setError('');
    try {
      await onResource(deleteFileResource({ channelId: channel.id, resourceId: entry.resourceId }));
      if (locationRef.current === mutationLocation) setSelectedKey('');
      await load({ expectedLocation: mutationLocation });
    } catch (failure) {
      if (locationRef.current === mutationLocation) {
        setStatus('error'); setError(failure?.message || String(failure));
      }
      throw failure;
    }
  }, [channel?.id, load, locationKey, onResource]);

  return {
    daemonId, setDaemonId, activeDaemon, channelLabel: channelName || channel?.id || '', directory, prefix, locationKey,
    entries, next, status, error, setError, selected, selectedKey, setSelectedKey,
    navigate, openDirectory, parent: () => navigate(parentDirectory(directory)),
    refresh, refreshLocation, isCurrentLocation, loadMore, createDirectory, deleteEntry,
    busy: status === 'loading' || status === 'loading-more' || status === 'mutating',
  };
}
