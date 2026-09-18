import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { availableDefaultStorageDeviceId, directoryEntries, directoryName, fileDirectoryPrefix, fileListCommand, normalizeDirectory, parentDirectory } from '../../model/channel-files.js';
import { createDirectoryResource, deleteFileResource, fileAddress } from '../../model/resources.js';

const PAGE_SIZE = 100;

// initialLocation / onLocationChange 是这个浏览器的"上次停在哪"。
//
// 它恒不自己持久化：位置属于"这个频道的文件区"，而这个 hook 每换一个频道就换一
// 个实例。谁活得比实例长，谁就该记——所以由 AppShell 拿着一张按频道的表，挂载时
// 交进来、变了再交回去。文件区从整屏 tab 改成分屏之后这条才成立：以前每次切走
// 都是真卸载，人回来恒从根目录重新往下点。
export function useChannelFileBrowser({ channel, devices = [], disabled = false, onResource, onFileOperation, initialLocation = null, onLocationChange }) {
  const defaultDaemonId = availableDefaultStorageDeviceId(channel, devices);
  const [daemonId, setDaemonId] = useState(initialLocation?.daemonId || defaultDaemonId);
  const [directory, setDirectory] = useState(initialLocation?.directory || '');
  const [items, setItems] = useState([]);
  const [next, setNext] = useState('');
  const [status, setStatus] = useState('idle');
  const [error, setError] = useState('');
  const [selectedKey, setSelectedKey] = useState('');
  const requestGeneration = useRef(0);
  // 恢复来的那个目录可能已经不在了（上次之后被删掉/改名）。恒不能因此让文件区
  // 从此打不开——第一次加载它失败就退回根目录重来，且只退这一次。
  const restoredDirectoryRef = useRef(initialLocation?.directory || '');

  const activeDaemon = devices.find((row) => row.id === daemonId);
  const deviceName = activeDaemon?.name || '';
  const channelName = channel?.qualified_name || channel?.name || '';
  const prefix = deviceName && channelName ? fileDirectoryPrefix({ deviceName, channelName, directory }) : '';
  const locationKey = `${channel?.id || ''}\u0000${daemonId}\u0000${directory}`;
  const locationRef = useRef(locationKey);
  locationRef.current = locationKey;
  const entries = useMemo(() => directoryEntries(items, prefix), [items, prefix]);
  const selected = entries.find((entry) => entry.key === selectedKey) || null;
  const performResource = useCallback((payload, access = 'read') => (
    onFileOperation
      ? onFileOperation({ channelId: channel?.id, access }, ({ resource }) => resource(payload))
      : onResource(payload)
  ), [channel?.id, onFileOperation, onResource]);

  // 下面两条都判"变了没有"而不是无条件写。挂载时无条件写等于把恢复来的位置立刻
  // 冲掉——恢复与重置会在同一次提交里打架，而重置恒在后面。频道换了是整个实例换
  // （组件按频道 key 重挂），所以这里只需要管同一个频道内的变化。
  // 空的设备表恒是"还不知道"，恒不是"你选的那台没了"。切频道时它会空上几帧，
  // 据此改选择就会把人从当前设备踢走、连带把目录清回根——恢复位置之后这一下
  // 变得看得见了：离开频道的那一瞬间，记下的位置先被改成空设备、再被清成根目录。
  // （同一条判据在 daemonhost 那边叫 absent vs unknown。）
  const known = devices.length > 0 && Boolean(defaultDaemonId);
  const seenDefaultRef = useRef(`${channel?.id || ''}\u0000${defaultDaemonId}`);
  useEffect(() => {
    if (!known) return;
    const key = `${channel?.id || ''}\u0000${defaultDaemonId}`;
    if (seenDefaultRef.current === key) return;
    seenDefaultRef.current = key;
    setDaemonId(defaultDaemonId);
  }, [known, channel?.id, defaultDaemonId]);

  useEffect(() => {
    if (!known) return;
    if (daemonId && !devices.some((row) => row.id === daemonId)) setDaemonId(defaultDaemonId);
  }, [known, daemonId, devices, defaultDaemonId]);

  // 换设备或换频道 → 回根目录：路径是那台机器上那个频道里的路径，换一个就没有
  // 意义了。调用方通常按频道 key 重挂这棵树，但这条恒不依赖它那么做——一个
  // 只在别人正确调用时才正确的 hook，是把自己的不变量寄放在别人身上。
  const seenLocationRef = useRef(`${channel?.id || ''}\u0000${daemonId}`);
  useEffect(() => {
    const key = `${channel?.id || ''}\u0000${daemonId}`;
    if (seenLocationRef.current === key) return;
    seenLocationRef.current = key;
    requestGeneration.current += 1;
    setDirectory(''); setItems([]); setNext(''); setSelectedKey('');
  }, [channel?.id, daemonId]);

  useEffect(() => { onLocationChange?.({ daemonId, directory }); }, [daemonId, directory, onLocationChange]);

  const load = useCallback(async ({ append = false, cursor = '', expectedLocation = locationKey } = {}) => {
    if (locationRef.current !== expectedLocation) return false;
    if (!channel?.id || !daemonId || !deviceName || !channelName || !onResource) {
      setItems([]); setNext(''); setStatus('ready');
      return true;
    }
    const generation = ++requestGeneration.current;
    setStatus(append ? 'loading-more' : 'loading');
    setError('');
    try {
      const page = await performResource(fileListCommand({
        channelId: channel.id, deviceName, channelName, directory, cursor, limit: PAGE_SIZE,
      }), 'read');
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
      if (restoredDirectoryRef.current && directory === restoredDirectoryRef.current) {
        restoredDirectoryRef.current = '';
        setDirectory('');
        return false;
      }
      setStatus('error');
      setError(failure?.message || String(failure));
      return false;
    }
  }, [channel?.id, channelName, daemonId, deviceName, directory, locationKey, onResource, performResource]);

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
    if (disabled) throw new TypeError('当前频道不可写');
    const mutationLocation = locationKey;
    const name = directoryName(value);
    const address = fileAddress({ deviceName, channelName, path: `${normalizeDirectory(directory)}${name}` });
    setStatus('mutating'); setError('');
    try {
      await performResource(createDirectoryResource({ channelId: channel.id, address }), 'write');
      await load({ expectedLocation: mutationLocation });
    } catch (failure) {
      if (locationRef.current === mutationLocation) {
        setStatus('error'); setError(failure?.message || String(failure));
      }
      throw failure;
    }
  }, [channel?.id, channelName, deviceName, directory, disabled, load, locationKey, performResource]);

  const deleteEntry = useCallback(async (entry) => {
    if (!entry?.resourceId) return;
    if (disabled) throw new TypeError('当前频道不可写');
    const mutationLocation = locationKey;
    setStatus('mutating'); setError('');
    try {
      await performResource(deleteFileResource({ channelId: channel.id, resourceId: entry.resourceId }), 'write');
      if (locationRef.current === mutationLocation) setSelectedKey('');
      await load({ expectedLocation: mutationLocation });
    } catch (failure) {
      if (locationRef.current === mutationLocation) {
        setStatus('error'); setError(failure?.message || String(failure));
      }
      throw failure;
    }
  }, [channel?.id, disabled, load, locationKey, performResource]);

  return {
    daemonId, setDaemonId, activeDaemon, channelLabel: channelName || channel?.id || '', directory, prefix, locationKey,
    entries, next, status, error, setError, selected, selectedKey, setSelectedKey,
    navigate, openDirectory, parent: () => navigate(parentDirectory(directory)),
    refresh, refreshLocation, isCurrentLocation, loadMore, createDirectory, deleteEntry,
    busy: status === 'loading' || status === 'loading-more' || status === 'mutating',
  };
}
