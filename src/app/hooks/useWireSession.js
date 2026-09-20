import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { describeClient } from '../../model/client-label.js';
import { isMobileProfile } from '../../model/device-profile.js';
import { diagnostic } from '../../model/diagnostics.js';
import {
  forgetCachedPrincipal,
  readCachedPrincipal,
  readWorkspaceBootstrap,
  rememberCachedPrincipal,
  writeWorkspaceBootstrap,
} from '../../model/workspace-bootstrap-cache.js';
import { createIdentityClient } from '../../net/identity.js';
import { createObsClient } from '../../net/obs.js';
import { foregroundWake } from '../../net/wake.js';
import { createWire } from '../../net/wire.js';
import { newId } from '../../util/id.js';

const SERVER_WORLD_KEY = 'atoll.server.boot.v2';
const CHANNEL_NAME_KEY = 'atoll.channel.names.v1';
const WORLD_PREFIXES = [
  'atoll.workspace.bootstrap.v2.',
  'atoll.history.priority.v1.',
  'atoll.cursor.v3.',
  'atoll.read.v4.',
  'atoll.timers.',
  'atoll.web.file-reading-history.v1.',
  'atoll.terminal.session.',
];

function storagePort() {
  try { return globalThis.localStorage || null; } catch { return null; }
}

export function readServerWorld() {
  return String(storagePort()?.getItem?.(SERVER_WORLD_KEY) || '');
}

function commitServerWorld(world) {
  if (!world) throw new TypeError('服务端 attach 缺少必需的 world 标识');
  const storage = storagePort();
  if (!storage) return true;
  const previous = storage.getItem(SERVER_WORLD_KEY);
  if (!previous || previous === world) {
    storage.setItem(SERVER_WORLD_KEY, world);
    return true;
  }
  const stale = [];
  for (let index = 0; index < storage.length; index += 1) {
    const key = storage.key(index);
    if (key === CHANNEL_NAME_KEY || WORLD_PREFIXES.some((prefix) => key?.startsWith(prefix))) stale.push(key);
  }
  for (const key of stale) storage.removeItem(key);
  storage.setItem(SERVER_WORLD_KEY, world);
  return false;
}

function rememberChannelLabels(profiles) {
  const storage = storagePort();
  if (!storage) return;
  let labels = {};
  try { labels = JSON.parse(storage.getItem(CHANNEL_NAME_KEY) || '{}') || {}; } catch { labels = {}; }
  for (const profile of profiles || []) {
    const label = profile?.qualified_name || profile?.name;
    if (profile?.id && label && label !== profile.id) labels[profile.id] = label;
  }
  try { storage.setItem(CHANNEL_NAME_KEY, JSON.stringify(Object.fromEntries(Object.entries(labels).slice(-256)))); } catch { /* cosmetic cache */ }
}

function cachedChannelLabel(channelId) {
  try { return JSON.parse(storagePort()?.getItem(CHANNEL_NAME_KEY) || '{}')?.[channelId] || ''; } catch { return ''; }
}

function accessMode(state, connected) {
  if (!state || state.existence === 'unknown') return 'loading';
  if (state.existence === 'retired') return 'retired';
  if (state.relationship === 'denied') return 'access_denied';
  if (state.relationship === 'member') {
    if (state.unavailable || (state.profile && state.runtime !== 'open')) return 'member_unavailable';
    return 'member_active';
  }
  if (state.relationship === 'observer') return connected && state.freshness === 'fresh' && state.runtime === 'open'
    ? 'observer_active'
    : 'observer_stale';
  return state.relationship === 'discoverable' ? 'discoverable' : 'loading';
}

function isHiddenChannel(profile) {
  const id = String(profile?.id || '');
  if (id === 'c0') return false;
  return id === 'c0.lobby'
    || profile?.name === 'lobby'
    || profile?.systemReserved === true
    || profile?.type === 'actor';
}

function createSessionAccess({ principalId }) {
  const states = new Map();
  let spaceDirectory = Object.freeze({
    principals: Object.freeze([]),
    declarations: Object.freeze([]),
    devices: Object.freeze([]),
    // Channel templates are registrar facts, not OBS rows. Keep the typed
    // projection slot explicit so Workspace can consume a future session
    // owner without making the governance feature read a space store.
    channelTemplates: null,
    support: Object.freeze({ principals: false, declarations: false, devices: false }),
  });
  let connected = false;
  let authorityEpoch = 0;
  const ensure = (channelId, profile = null) => {
    if (!states.has(channelId)) states.set(channelId, {
      channelId,
      profile,
      existence: profile ? 'present' : 'unknown',
      runtime: profile?.open === false ? 'closed' : profile?.open === true ? 'open' : 'unknown',
      relationship: 'unknown',
      freshness: 'initial',
      unavailable: false,
      selfActorId: '',
      authorityEpoch: ++authorityEpoch,
    });
    const state = states.get(channelId);
    if (profile) state.profile = profile;
    return state;
  };
  const changeAuthority = (state, mutate) => {
    const before = `${state.existence}:${state.relationship}:${state.selfActorId}`;
    mutate(state);
    if (before !== `${state.existence}:${state.relationship}:${state.selfActorId}`) state.authorityEpoch = ++authorityEpoch;
  };
  return {
    channelsObserved(profiles, { complete = true } = {}) {
      const seen = new Set();
      for (const profile of profiles || []) {
        if (!profile?.id) continue;
        if (isHiddenChannel(profile)) continue;
        seen.add(profile.id);
        const state = ensure(profile.id, profile);
        changeAuthority(state, (next) => {
          next.profile = profile;
          next.existence = profile.status === 'retired' ? 'retired' : 'present';
          next.runtime = profile.open === false ? 'closed' : profile.open === true ? 'open' : 'unknown';
          next.unavailable = profile.open === true ? false : next.unavailable;
          if (profile.id === 'c0' && profile.owner_principal === principalId) {
            next.relationship = 'member';
            next.freshness = connected ? 'fresh' : 'stale';
            next.unavailable = false;
          }
          else if (next.relationship === 'unknown') next.relationship = 'discoverable';
        });
      }
      if (complete) for (const state of states.values()) if (state.profile && !seen.has(state.channelId)) changeAuthority(state, (next) => {
        next.existence = 'retired';
        next.runtime = 'closed';
        next.freshness = 'fresh';
        next.unavailable = false;
      });
    },
    directoryObserved(directory) {
      const incoming = directory && typeof directory === 'object' ? directory : {};
      // OBS refreshes do not own Registrar facts. Preserve the last canonical
      // template projection until the session/world owner explicitly resets it.
      spaceDirectory = Object.freeze({
        ...incoming,
        channelTemplates: Array.isArray(incoming.channelTemplates)
          ? incoming.channelTemplates
          : spaceDirectory.channelTemplates,
      });
    },
    channelTemplatesObserved(rows) {
      if (!Array.isArray(rows)) return false;
      spaceDirectory = Object.freeze({
        ...spaceDirectory,
        channelTemplates: mergeChannelTemplateRows(spaceDirectory.channelTemplates, rows),
      });
      return true;
    },
    channelTemplateObserved(value) {
      const row = normalizeChannelTemplate(value);
      if (!row) return false;
      const rows = [...(spaceDirectory.channelTemplates || []), row];
      const byId = new Map(rows.map((entry) => [entry.id, entry]));
      spaceDirectory = Object.freeze({
        ...spaceDirectory,
        channelTemplates: mergeChannelTemplateRows([], [...byId.values()]),
      });
      return true;
    },
    membershipsObserved(rows, { complete = true } = {}) {
      const active = new Set();
      for (const row of rows || []) {
        if (!row?.channel_id) continue;
        const state = ensure(row.channel_id);
        if (row.status === 'active') {
          active.add(row.channel_id);
          changeAuthority(state, (next) => {
            if (next.existence !== 'retired') next.existence = 'present';
            next.relationship = 'member';
            next.freshness = connected ? 'fresh' : 'stale';
            next.unavailable = false;
            if (row.actor_id) next.selfActorId = row.actor_id;
          });
        } else if (row.status === 'revoked'
          && !(state.channelId === 'c0' && state.profile?.owner_principal === principalId)) {
          changeAuthority(state, (next) => {
            next.relationship = 'denied';
            next.freshness = 'fresh';
            next.selfActorId = '';
            next.unavailable = false;
          });
        }
      }
      if (complete) for (const state of states.values()) {
        if (state.relationship === 'member' && !active.has(state.channelId) && !(state.channelId === 'c0' && state.profile?.owner_principal === principalId)) {
          changeAuthority(state, (next) => {
            next.relationship = 'denied';
            next.freshness = 'fresh';
            next.selfActorId = '';
            next.unavailable = false;
          });
        }
      }
    },
    live(channelId) {
      const state = ensure(channelId);
      const before = `${state.existence}:${state.relationship}:${state.unavailable}`;
      if (state.existence !== 'retired') state.existence = 'present';
      if (state.relationship !== 'member') state.relationship = 'observer';
      state.unavailable = false; state.freshness = 'fresh';
      return before !== `${state.existence}:${state.relationship}:${state.unavailable}`;
    },
    forbidden(channelId) { const state = ensure(channelId); changeAuthority(state, (next) => { next.relationship = 'denied'; next.freshness = 'fresh'; next.selfActorId = ''; next.unavailable = false; }); },
    unavailable(channelId) { const state = ensure(channelId); state.unavailable = true; state.freshness = connected ? 'fresh' : 'stale'; },
    retire(channelId) { const state = ensure(channelId); changeAuthority(state, (next) => { next.existence = 'retired'; next.runtime = 'closed'; next.freshness = 'fresh'; next.unavailable = false; }); },
    wire(status) {
      connected = status === 'attached';
      for (const state of states.values()) {
        if (state.relationship === 'member') state.freshness = connected ? 'fresh' : 'stale';
        else if (state.relationship === 'observer' && !connected) state.freshness = 'stale';
      }
    },
    clearSelf(channelId) { const state = ensure(channelId); changeAuthority(state, (next) => { next.selfActorId = ''; }); },
    reset() {
      states.clear(); connected = false; authorityEpoch += 1;
      spaceDirectory = Object.freeze({
        principals: Object.freeze([]), declarations: Object.freeze([]), devices: Object.freeze([]),
        channelTemplates: null,
        support: Object.freeze({ principals: false, declarations: false, devices: false }),
      });
    },
    state(channelId) { return states.get(channelId) || null; },
    directory() { return spaceDirectory; },
    rows({ includeRetired = false } = {}) {
      return [...states.values()]
        .filter((state) => !isHiddenChannel(state.profile || { id: state.channelId }))
        .filter((state) => includeRetired || state.existence !== 'retired')
        .map((state) => {
          const profile = state.profile || { id: state.channelId, name: cachedChannelLabel(state.channelId) || state.channelId };
          return { ...profile, id: state.channelId, access: accessMode(state, connected), accessState: { ...state, mode: accessMode(state, connected) }, selfActorId: state.selfActorId };
        });
    },
    snapshot() {
      return {
        channels: [...states.values()].map((state) => ({ ...state, mode: accessMode(state, connected) })),
      };
    },
  };
}

function projectDirectoryRows(observation, { withOnline = false } = {}) {
  return Object.freeze((observation?.items || []).flatMap((item) => {
    const declared = item?.declared || {};
    const id = declared.id || item?.key;
    if (!id || (declared.status && declared.status !== 'present')) return [];
    if (!withOnline) return [Object.freeze({ ...declared })];
    const measures = Object.fromEntries((item?.actual?.measures || []).map((measure) => [
      measure.name,
      measure.unknown ? undefined : measure.value,
    ]));
    return [Object.freeze({
      id,
      name: declared.name || id,
      status: declared.status || 'present',
      description: declared.description || '',
      online: measures.online ?? measures.device_online,
    })];
  }));
}

function normalizeChannelTemplate(value) {
  const row = value?.declared || value;
  if (!row || typeof row !== 'object' || Array.isArray(row)) return null;
  const id = String(row?.id || '').trim();
  if (!id) return null;
  const { body, ...withoutBody } = row;
  return Object.freeze({
    ...withoutBody,
    id,
    ...(body && typeof body === 'object' && !Array.isArray(body) ? { body } : {}),
  });
}

function mergeChannelTemplateRows(previous, incoming) {
  const prior = new Map((previous || []).map((row) => [String(row?.id || ''), row]));
  return Object.freeze((incoming || []).map((value) => {
    const row = normalizeChannelTemplate(value);
    if (!row) return null;
    const old = prior.get(row.id);
    return normalizeChannelTemplate({
      ...old,
      ...row,
      ...(!row.body && old?.body ? { body: old.body } : {}),
    });
  }).filter(Boolean));
}

async function loadSpaceDirectory(obs) {
  const load = async (request, options) => {
    try { return { rows: projectDirectoryRows(await request(), options), supported: true }; }
    catch (error) {
      if (error?.status === 401) throw error;
      return { rows: Object.freeze([]), supported: false };
    }
  };
  const [principals, declarations, devices] = await Promise.all([
    load(() => obs.spacePrincipals()),
    load(() => obs.spaceDecls()),
    load(() => obs.spaceDaemons(), { withOnline: true }),
  ]);
  return Object.freeze({
    principals: principals.rows,
    declarations: declarations.rows,
    devices: devices.rows,
    // No OBS endpoint exists for templates; a registrar command owner may
    // later publish rows through this same projection slot.
    channelTemplates: null,
    support: Object.freeze({
      principals: principals.supported,
      declarations: declarations.supported,
      devices: devices.supported,
    }),
  });
}

async function loadChannelTree(obs) {
  const found = new Map();
  let level = [undefined];
  const expanded = new Set();
  let complete = true;
  while (level.length) {
    const parents = level.filter((parentId) => {
      const marker = parentId || '__root__';
      if (expanded.has(marker)) return false;
      expanded.add(marker);
      return true;
    });
    const observations = [];
    for (let offset = 0; offset < parents.length; offset += 6) {
      observations.push(...await Promise.all(parents.slice(offset, offset + 6).map(async (parentId) => ({
        observation: await obs.spaceChannels(parentId),
      }))));
    }
    const next = [];
    for (const { observation } of observations) {
      if (observation.complete === false) complete = false;
      for (const item of observation.items || []) {
        const row = item.declared || {};
        if (row.status !== 'present' || !row.id) continue;
        const openMeasure = (item.actual?.measures || []).find((measure) => measure.name === 'open');
        found.set(row.id, { ...row, open: openMeasure?.unknown ? undefined : openMeasure?.value });
        if (!expanded.has(row.id)) next.push(row.id);
      }
    }
    level = next;
  }
  return { channels: found, complete };
}

const ROUTE_FOCUS_TYPES = new Set(['turn', 'artifact', 'work_item', 'participant', 'channel']);

function parseRouteFocus(value) {
  const raw = String(value || '');
  const separator = raw.indexOf(':');
  if (separator <= 0) return null;
  const type = raw.slice(0, separator);
  const key = raw.slice(separator + 1);
  if (!ROUTE_FOCUS_TYPES.has(type) || !key) return null;
  return Object.freeze({ type, key });
}

function readInitialRoute() {
  const hash = String(globalThis.location?.hash || '');
  const match = hash.match(/^#\/channels\/([^/]+)\/([^?]+)/);
  if (!match) return { channelId: '', view: 'conversation', focus: null };
  let channelId = '';
  let rawView = '';
  try { channelId = decodeURIComponent(match[1]); rawView = decodeURIComponent(match[2]); } catch { return { channelId: '', view: 'conversation', focus: null }; }
  let rawFocus = '';
  const queryStart = hash.indexOf('?');
  if (queryStart >= 0) {
    try { rawFocus = new URLSearchParams(hash.slice(queryStart + 1)).get('focus') || ''; } catch { rawFocus = ''; }
  }
  return {
    channelId,
    view: ['conversation', 'files', 'tasks'].includes(rawView) ? rawView : 'conversation',
    focus: parseRouteFocus(rawFocus),
  };
}

function writeRoute(channelId, view, replace = false, focus = null) {
  if (!channelId || !globalThis.history) return;
  const suffix = focus?.type && focus?.key
    ? `?focus=${encodeURIComponent(`${focus.type}:${focus.key}`)}`
    : '';
  globalThis.history[replace ? 'replaceState' : 'pushState'](
    globalThis.history.state,
    '',
    `#/channels/${encodeURIComponent(channelId)}/${encodeURIComponent(view)}${suffix}`,
  );
}

// Authentication is part of the wire session lifetime. Keeping it here makes
// logout/401 a principal boundary for every owner mounted by WorkspaceApp.
export function useIdentitySession({ onError = () => {} } = {}) {
  const [booting, setBooting] = useState(true);
  const [principal, setPrincipal] = useState(null);
  const identityRef = useRef(null);
  if (identityRef.current === null) identityRef.current = createIdentityClient();

  useEffect(() => {
    let current = true;
    void identityRef.current.session().then((session) => {
      if (!current) return;
      // Cached identity is display metadata only. Never publish a principal
      // (and therefore mount its workspace owners) before the server session
      // has authenticated that same principal.
      const cached = readCachedPrincipal();
      const value = cached?.id === session.id
        ? cached
        : { id: session.id, display_name: session.display_name || '' };
      rememberCachedPrincipal(value);
      setPrincipal(value);
    }).catch((error) => {
      if (!current) return;
      if (error?.status === 401) {
        forgetCachedPrincipal();
        setPrincipal(null);
      } else onError(error);
    }).finally(() => { if (current) setBooting(false); });
    return () => { current = false; };
  }, [onError]);

  const accept = useCallback((value) => {
    const next = { id: value.id, display_name: value.display_name || '' };
    rememberCachedPrincipal(next);
    setPrincipal(next);
    setBooting(false);
  }, []);
  const expire = useCallback(() => {
    forgetCachedPrincipal();
    setPrincipal(null);
    setBooting(false);
  }, []);
  const logout = useCallback(async () => {
    try { await identityRef.current.logout(); } catch { /* local boundary still wins */ }
    expire();
  }, [expire]);

  return { accept, booting, expire, identity: identityRef.current, logout, principal };
}

// Channel selection and URL projection are one navigation owner. The access
// tracker remains the authority; this hook only chooses which authoritative
// row the shell is presenting.
export function useChannelNavigation({ accessRef, rosterRef, onSelect = () => {}, onNotice = () => {} }) {
  const initialRef = useRef(null);
  if (initialRef.current === null) initialRef.current = readInitialRoute();
  const [profiles, setProfiles] = useState(new Map());
  const [revision, setRevision] = useState(0);
  // Terminal session identity and screen replay belong to the PTY owner. This
  // is only the per-channel navigation fact of whether that existing session
  // is expanded in the workspace.
  const [terminalChannels, setTerminalChannels] = useState(() => new Set());
  // The URL is only a request. A freshly authenticated principal has no
  // active channel until its own directory/access owner validates that id.
  const [activeChannelId, setActiveChannelId] = useState('');
  const [activeView, setActiveViewState] = useState(initialRef.current.view);
  const [focus, setFocusState] = useState(initialRef.current.focus);
  const activeChannelRef = useRef(activeChannelId);
  const activeViewRef = useRef(activeView);
  const focusRef = useRef(focus);
  // Tasks is a temporary excursion from the committed Files route. Keep this
  // handoff fact inside the existing navigation owner so Layout does not grow
  // a second route store or infer it from mounted DOM.
  const filesReturnIntentRef = useRef(null);
  useLayoutEffect(() => { activeChannelRef.current = activeChannelId; }, [activeChannelId]);
  useLayoutEffect(() => { activeViewRef.current = activeView; }, [activeView]);
  useLayoutEffect(() => { focusRef.current = focus; }, [focus]);
  const commitActiveChannel = useCallback((channelId) => {
    if (activeChannelRef.current !== channelId) filesReturnIntentRef.current = null;
    activeChannelRef.current = channelId;
    setActiveChannelId(channelId);
  }, []);
  const commitActiveView = useCallback((view) => {
    activeViewRef.current = view;
    setActiveViewState(view);
  }, []);
  const commitFocus = useCallback((nextFocus) => {
    focusRef.current = nextFocus;
    setFocusState(nextFocus);
  }, []);
  const channels = useMemo(() => {
    const authoritative = accessRef.current?.rows?.() || [];
    const rows = authoritative.length ? authoritative : [...profiles.values()];
    return [...rows].sort((left, right) => {
      if (left.id === 'c0') return -1;
      if (right.id === 'c0') return 1;
      return String(left.qualified_name || left.name || left.id).localeCompare(String(right.qualified_name || right.name || right.id));
    });
  }, [accessRef, profiles, revision]);

  useEffect(() => {
    if (!channels.length) return;
    if (!activeChannelId || !channels.some((row) => row.id === activeChannelId)) {
      if (activeChannelId && accessRef.current?.state?.(activeChannelId)?.existence === 'retired') onNotice(`${activeChannelId} 已退役，已切换到其他可用频道。`);
      const requested = channels.find((row) => row.id === initialRef.current.channelId);
      const next = requested || channels.find((row) => row.access === 'member_active') || channels[0];
      const nextFocus = requested?.id === next.id ? initialRef.current.focus : null;
      commitActiveChannel(next.id);
      commitFocus(nextFocus);
      writeRoute(next.id, activeViewRef.current, true, nextFocus);
    }
  }, [accessRef, activeChannelId, channels, commitActiveChannel, commitFocus, onNotice]);

  // Terminal visibility is a navigation fact, so directory/world replacement
  // must retire facts for identities that are no longer in the public channel
  // projection.  The terminal feature keeps its existing session port; this
  // only prevents a deleted channel from becoming visible again if it returns.
  useEffect(() => {
    const available = new Set(channels.map((row) => row.id));
    setTerminalChannels((current) => {
      if (!current.size) return current;
      const next = new Set([...current].filter((channelId) => available.has(channelId)));
      return next.size === current.size ? current : next;
    });
  }, [channels]);

  useEffect(() => {
    const receiveRoute = () => {
      const route = readInitialRoute();
      if (route.channelId && channels.some((row) => row.id === route.channelId)) {
        const changedChannel = route.channelId !== activeChannelRef.current;
        // A browser route is an authoritative navigation request. It must not
        // inherit an in-memory Files→Tasks return handoff from an older route.
        filesReturnIntentRef.current = null;
        commitActiveChannel(route.channelId);
        commitActiveView(route.view);
        commitFocus(route.focus);
        if (changedChannel) onSelect(route.channelId);
      }
    };
    globalThis.addEventListener?.('hashchange', receiveRoute);
    globalThis.addEventListener?.('popstate', receiveRoute);
    return () => {
      globalThis.removeEventListener?.('hashchange', receiveRoute);
      globalThis.removeEventListener?.('popstate', receiveRoute);
    };
  }, [channels, commitActiveChannel, commitActiveView, commitFocus, onSelect]);

  const select = useCallback((channelId) => {
    // The boolean is only an acceptance signal for shell handoff gates;
    // activeChannelRef/state remains the sole selection authority.
    if (!channelId || channelId === activeChannelRef.current) return false;
    commitActiveChannel(channelId);
    commitFocus(null);
    onSelect(channelId);
    writeRoute(channelId, activeViewRef.current);
    return true;
  }, [commitActiveChannel, commitFocus, onSelect]);
  const setActiveView = useCallback((view) => {
    if (!['conversation', 'files', 'tasks'].includes(view)) return;
    const channelId = activeChannelRef.current;
    let nextView = view;
    if (view === 'tasks') {
      if (activeViewRef.current === 'files' && channelId) filesReturnIntentRef.current = channelId;
    } else if (view === 'files') {
      // Opening or explicitly staying on Files is a new primary intent.
      filesReturnIntentRef.current = null;
    } else if (filesReturnIntentRef.current === channelId) {
      // The Dynamic tab is the return edge for a temporary Tasks excursion.
      nextView = 'files';
      filesReturnIntentRef.current = null;
    } else {
      filesReturnIntentRef.current = null;
    }
    commitActiveView(nextView);
    commitFocus(null);
    writeRoute(channelId, nextView);
  }, [commitActiveView, commitFocus]);
  const setFocus = useCallback((nextFocus) => {
    const normalized = nextFocus?.type && nextFocus?.key
      ? parseRouteFocus(`${nextFocus.type}:${nextFocus.key}`)
      : null;
    commitFocus(normalized);
    writeRoute(activeChannelRef.current, activeViewRef.current, false, normalized);
  }, [commitFocus]);
  const setTerminalVisible = useCallback((nextValue) => {
    const channelId = activeChannelRef.current;
    if (!channelId) return false;
    setTerminalChannels((current) => {
      const visible = current.has(channelId);
      const next = typeof nextValue === 'function' ? Boolean(nextValue(visible)) : Boolean(nextValue);
      if (visible === next) return current;
      const channels = new Set(current);
      if (next) channels.add(channelId);
      else channels.delete(channelId);
      return channels;
    });
    return true;
  }, []);
  const bump = useCallback(() => setRevision((value) => value + 1), []);
  const setChannels = useCallback((next) => {
    if (next instanceof Map && next.size === 0) {
      filesReturnIntentRef.current = null;
      setTerminalChannels((current) => (current.size ? new Set() : current));
    }
    setProfiles(next);
  }, []);
  const clear = useCallback(() => {
    filesReturnIntentRef.current = null;
    setProfiles(new Map());
    setTerminalChannels(new Set());
    commitActiveChannel('');
    commitFocus(null);
    setRevision((value) => value + 1);
  }, [commitActiveChannel, commitFocus]);

  return {
    activeChannel: channels.find((row) => row.id === activeChannelId) || null,
    activeChannelId,
    activeChannelRef,
    activeView,
    focus,
    bump,
    channels,
    clear,
    revision,
    select,
    setTerminalVisible,
    selfFor: (channelId) => rosterRef.current?.self?.(channelId) || '',
    setActiveChannelId: commitActiveChannel,
    setActiveView,
    setFocus,
    setChannels,
    terminalVisible: terminalChannels.has(activeChannelId),
  };
}

export function useWireSessionPort() {
  const [state, setState] = useState('closed');
  const [incompatible, setIncompatible] = useState(null);
  const incompatibleRef = useRef(null);
  const incompatibleEpochRef = useRef(0);
  const obsRef = useRef(null);
  const wireRef = useRef(null);
  const rosterRef = useRef(null);
  const accessRef = useRef(null);

  const close = useCallback(() => {
    const owner = wireRef.current;
    owner?.close();
    if (wireRef.current === owner) wireRef.current = null;
    setState('closed');
  }, []);

  return useMemo(() => ({
    accessRef,
    close,
    incompatible,
    incompatibleEpochRef,
    incompatibleRef,
    obsRef,
    rosterRef,
    setIncompatible,
    setState,
    state,
    wireRef,
  }), [close, incompatible, state]);
}

export function useWireConnection({
  accessActionsRef,
  activeChannelRef,
  agentActivityRef,
  bumpAccess,
  cancelFeedTask,
  disconnectHistory,
  displayError,
  enqueueFeed,
  expireSession,
  finishHistoryPage,
  finishLiveCheckpoint,
  onServerWorld,
  onWorldChanged,
  port,
  prepareLocalReplica,
  principalId,
  reconcileIdentity,
  refreshHistoryChannel,
  resetSubmissionWorld,
  resumeLocalReplica,
  setActiveChannelId,
  setChannels,
  setHistoryGrants,
  setTopError,
  stopIncompatibleFeed,
}) {
  const internalAccessActionsRef = useRef({});
  const accessRefreshActionsRef = accessActionsRef || internalAccessActionsRef;
  const {
    accessRef,
    incompatibleEpochRef,
    incompatibleRef,
    obsRef,
    rosterRef,
    setIncompatible,
    setState,
    wireRef,
  } = port;

  useEffect(() => {
    if (!principalId) return undefined;
    setTopError('');
    const obs = createObsClient({ onUnauthorized: expireSession });
    const roster = rosterRef.current;
    const access = createSessionAccess({ principalId });
    obsRef.current = obs;
    accessRef.current = access;

    const cachedBootstrap = readWorkspaceBootstrap(principalId);
    let localFocus = activeChannelRef.current;
    if (cachedBootstrap.memberships.length) {
      roster?.seed(cachedBootstrap.rosters);
      for (const entry of cachedBootstrap.memberships) roster?.noteSelf(entry.channel_id, entry.actor_id);
      access.channelsObserved(cachedBootstrap.profiles, { complete: false });
      access.membershipsObserved(cachedBootstrap.memberships, { complete: false, supported: true });
      access.wire('disconnected');
      setChannels(new Map(cachedBootstrap.profiles.map((row) => [row.id, row])));
      if (!localFocus) {
        localFocus = cachedBootstrap.memberships[0]?.channel_id || '';
        activeChannelRef.current = localFocus;
        if (localFocus) setActiveChannelId(localFocus);
      }
      bumpAccess();
    }

    let alive = true;
    let refreshTimer = null;
    let refreshInFlight = null;
    let refreshQueued = false;
    let attachedOnce = false;
    let wire = null;
    let attachedGeneration = 0;
    let versionBlocked = false;
    const scheduleAccessRefresh = () => {
      if (!alive || versionBlocked || refreshTimer != null) return;
      refreshTimer = setTimeout(() => {
        refreshTimer = null;
        void refreshAccess();
      }, 250);
    };
    const refreshAccess = () => {
      if (versionBlocked) return Promise.resolve();
      if (refreshInFlight) {
        refreshQueued = true;
        return refreshInFlight;
      }
      refreshInFlight = Promise.all([loadChannelTree(obs), loadSpaceDirectory(obs)]).then(([result, directory]) => {
        if (!alive || versionBlocked) return;
        const profiles = [...result.channels.values()];
        rememberChannelLabels(profiles);
        access.channelsObserved(profiles, { complete: result.complete });
        access.directoryObserved(directory);
        writeWorkspaceBootstrap(principalId, access.snapshot());
        setChannels((current) => result.complete ? result.channels : new Map([...current, ...result.channels]));
        bumpAccess();
      }).catch((error) => {
        if (alive && error?.status !== 401) {
          diagnostic('error', 'directory.refresh_failed', { error });
          setTopError(displayError(error));
        }
      }).finally(() => {
        refreshInFlight = null;
        if (alive && refreshQueued) {
          refreshQueued = false;
          scheduleAccessRefresh();
        }
      });
      return refreshInFlight;
    };
    const accessRefreshActions = { schedule: scheduleAccessRefresh, refresh: refreshAccess };
    accessRefreshActionsRef.current = accessRefreshActions;
    void refreshAccess();

    setState('connecting');
    void prepareLocalReplica(principalId, { focus: localFocus });
    const wireOptions = {
      label: describeClient(),
      maxReconnectDelayMs: isMobileProfile() ? 5_000 : 30_000,
      wake: foregroundWake(),
      since: resumeLocalReplica,
      focus: () => activeChannelRef.current,
      onAttach: (detail) => {
        const nextGeneration = Number(detail?.generation);
        attachedGeneration = Number.isSafeInteger(nextGeneration) && nextGeneration > 0
          ? nextGeneration
          : 0;
        const sameServerWorld = commitServerWorld(detail?.boot);
        onServerWorld(String(detail?.boot || readServerWorld()));
        if (!sameServerWorld) {
          access.reset();
          roster?.reset();
          resetSubmissionWorld();
          setChannels(new Map());
          bumpAccess();
          const worldReset = onWorldChanged();
          const applyHistoryGrants = () => {
            const focus = String(activeChannelRef.current || '');
            return Promise.resolve(setHistoryGrants(detail?.history_meta || [], {
              ...detail,
              focus,
              forceReset: true,
            })).then((result) => {
              if (!focus || typeof refreshHistoryChannel !== 'function') return result;
              return Promise.resolve(refreshHistoryChannel(focus)).then(() => result);
            });
          };
          return worldReset && typeof worldReset.then === 'function'
            ? Promise.resolve(worldReset).then(applyHistoryGrants)
            : applyHistoryGrants();
        }
        const focus = String(activeChannelRef.current || '');
        return Promise.resolve(setHistoryGrants(detail?.history_meta || [], {
          ...detail,
          focus,
          forceReset: !sameServerWorld,
        })).then((result) => {
          if (!focus || typeof refreshHistoryChannel !== 'function') return result;
          return Promise.resolve(refreshHistoryChannel(focus)).then(() => result);
        });
      },
      onFeed: enqueueFeed,
      onCheckpoint: finishLiveCheckpoint,
      onPageEnd: finishHistoryPage,
      onError: (error) => {
        if (error?.code !== 'closed') {
          diagnostic('error', 'wire.failed', { error });
          setTopError(`${error.code}: ${displayError(error)}`);
        }
      },
      onObserveEnded: (channelId, reason) => {
        diagnostic('warn', 'wire.observe_ended', { channelId, reason });
        if (reason === 'channel_retired') access.retire(channelId, reason);
        setTopError(`${channelId} 旁听已结束：${reason}`);
        bumpAccess();
      },
      onState: (state, detail) => {
        if (state === 'incompatible') {
          if (incompatibleRef.current) return;
          versionBlocked = true;
          incompatibleRef.current = detail || {};
          incompatibleEpochRef.current += 1;
          if (refreshTimer != null) clearTimeout(refreshTimer);
          refreshTimer = null;
          accessRefreshActionsRef.current = {};
          agentActivityRef.current.disconnect();
          roster?.close();
          access.wire('disconnected');
          stopIncompatibleFeed(detail?.generation);
          setState('incompatible');
          setIncompatible((current) => current || detail || {});
        } else if (state === 'attached') {
          agentActivityRef.current.attach(detail);
          access.wire('attached', newId());
          if (Array.isArray(detail?.memberships)) {
            const rows = detail.memberships
              .filter((entry) => entry?.channel_id)
              .map((entry) => ({ channel_id: entry.channel_id, status: 'active', actor_id: entry.actor_id || '' }));
            const memberedBefore = access.rows()
              .filter((row) => row.accessState?.relationship === 'member')
              .map((row) => row.id);
            access.membershipsObserved(rows, { complete: detail.memberships_complete === true, supported: true });
            writeWorkspaceBootstrap(principalId, access.snapshot());
            for (const entry of rows) {
              if (!roster?.noteSelf(entry.channel_id, entry.actor_id)) continue;
              reconcileIdentity(entry.channel_id, entry.actor_id);
            }
            for (const channelId of memberedBefore) {
              if (access.state(channelId)?.relationship !== 'member') roster?.clearSelf(channelId);
            }
          }
          setState('open');
          if (attachedOnce) scheduleAccessRefresh();
          attachedOnce = true;
        } else if (state === 'disconnected') {
          agentActivityRef.current.disconnect();
          disconnectHistory(detail?.generation);
        } else if (state === 'reconnecting') {
          agentActivityRef.current.disconnect();
          access.wire('disconnected');
          setState('reconnecting');
        } else if (state === 'closed') {
          agentActivityRef.current.disconnect();
          access.wire('disconnected');
          setState('closed');
        } else if (state === 'open') {
          setState((current) => current === 'open' ? current : 'connecting');
        }
        bumpAccess();
      },
    };
    queueMicrotask(() => {
      if (!alive) return;
      wire = createWire(wireOptions);
      wireRef.current = wire;
    });

    return () => {
      alive = false;
      if (refreshTimer != null) clearTimeout(refreshTimer);
      const ownedWire = wire;
      const ownedGeneration = attachedGeneration;
      wire = null;
      attachedGeneration = 0;
      if (accessRefreshActionsRef.current === accessRefreshActions) accessRefreshActionsRef.current = {};
      ownedWire?.close();
      roster?.close();
      cancelFeedTask(ownedWire, ownedGeneration);
      if (obsRef.current === obs) obsRef.current = null;
      if (accessRef.current === access) accessRef.current = null;
      if (wireRef.current === ownedWire) wireRef.current = null;
    };
  }, [accessRef, accessRefreshActionsRef, activeChannelRef, agentActivityRef, bumpAccess, cancelFeedTask, disconnectHistory, displayError, enqueueFeed, expireSession, finishHistoryPage, finishLiveCheckpoint, incompatibleEpochRef, incompatibleRef, obsRef, onServerWorld, onWorldChanged, prepareLocalReplica, principalId, reconcileIdentity, refreshHistoryChannel, resetSubmissionWorld, resumeLocalReplica, rosterRef, setActiveChannelId, setChannels, setHistoryGrants, setIncompatible, setState, setTopError, stopIncompatibleFeed, wireRef]);

  return accessRefreshActionsRef;
}
