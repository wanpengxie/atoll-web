import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
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
const UPDATE_CHECK_INTERVAL_MS = 6 * 60 * 60 * 1_000;
const ACTIVE_NODE_UPDATE_STATES = new Set([
  'starting',
  'downloading',
  'verifying',
  'installing',
  'restarting',
]);
const NODE_UPDATE_UNAVAILABLE_DETAIL = '当前节点升级能力不可用，请刷新或联系管理员/手动升级';
const WORLD_PREFIXES = [
  'atoll.workspace.bootstrap.v2.',
  'atoll.history.priority.v1.',
  'atoll.cursor.v3.',
  'atoll.read.v4.',
  'atoll.timers.',
  'atoll.web.file-reading-history.v1.',
  'atoll.terminal.session.',
];

function nodeUpdateError(response, body) {
  const error = new Error(body?.detail || `升级请求失败（HTTP ${response.status}）`);
  error.status = response.status;
  error.code = body?.code || 'update_failed';
  error.detail = body?.detail || error.message;
  error.body = body;
  return error;
}

async function requestNodeUpdate(path, options = {}) {
  const response = await globalThis.fetch(path, {
    ...options,
    credentials: 'include',
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw nodeUpdateError(response, body);
  return body;
}

function developmentUpdate(value) {
  return String(value?.detail || '').includes('开发版')
    || String(value?.detail || '').toLowerCase().includes('development build')
    || String(value?.status || '').toLowerCase() === 'unsupported';
}

function projectNodeUpdate(value) {
  if (!value || typeof value !== 'object') return null;
  if (developmentUpdate(value)) {
    return {
      ...value,
      status: 'unsupported',
      available: false,
      detail: value.detail || '开发版不执行自动升级',
    };
  }
  return value;
}

function unavailableNodeUpdate(previous, error) {
  const body = error?.body && typeof error.body === 'object' ? error.body : {};
  const currentVersion = body.current_version
    ?? previous?.current_version
    ?? previous?.currentVersion
    ?? null;
  const latestVersion = body.latest_version
    ?? previous?.latest_version
    ?? previous?.latestVersion
    ?? '';
  const detail = body.detail
    || error?.detail
    || (error?.status === 403
      ? '当前账号没有节点升级权限'
      : error?.status === 503
        ? '节点升级服务暂不可用，请稍后重试'
        : NODE_UPDATE_UNAVAILABLE_DETAIL);
  return {
    ...(previous || {}),
    ...body,
    current_version: currentVersion,
    latest_version: latestVersion,
    available: false,
    status: 'unsupported',
    detail,
    unavailable: true,
    error_status: error?.status || 0,
  };
}

function useNodeUpdate({ principalId = '', wireState = 'closed' } = {}) {
  const [value, setValue] = useState(null);
  const [pending, setPending] = useState(false);
  const valueRef = useRef(null);
  const mountedRef = useRef(false);
  const refreshInFlightRef = useRef(null);
  const startInFlightRef = useRef(null);
  const hasConnectedRef = useRef(false);

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  useEffect(() => { valueRef.current = value; }, [value]);

  const refresh = useCallback((check = false) => {
    if (principalId !== 'root') return Promise.resolve(null);
    if (refreshInFlightRef.current) return refreshInFlightRef.current;
    const request = requestNodeUpdate(`/api/update${check ? '?check=1' : ''}`)
      .then((next) => {
        const projected = projectNodeUpdate(next);
        valueRef.current = projected;
        if (mountedRef.current) setValue(projected);
        return projected;
      })
      .catch((error) => {
        const current = valueRef.current;
        // A restarting node can close this HTTP request before the next
        // process is reachable. Keep the authoritative active phase until a
        // later reconnect/check receipt replaces it; HTTP permission/service
        // failures are explicit unavailable projections instead.
        if (mountedRef.current && !ACTIVE_NODE_UPDATE_STATES.has(current?.status)) {
          const projected = unavailableNodeUpdate(current, error);
          valueRef.current = projected;
          setValue(projected);
        }
        return null;
      })
      .finally(() => {
        if (refreshInFlightRef.current === request) refreshInFlightRef.current = null;
      });
    refreshInFlightRef.current = request;
    return request;
  }, [principalId]);

  useEffect(() => {
    if (principalId !== 'root') {
      valueRef.current = null;
      hasConnectedRef.current = false;
      setValue(null);
      setPending(false);
      return undefined;
    }
    // The status check is an authenticated root-only HTTP capability. The
    // six-hour timer is a bounded freshness check, not an update poll.
    void refresh(true);
    const timer = globalThis.setInterval(() => { void refresh(true); }, UPDATE_CHECK_INTERVAL_MS);
    return () => globalThis.clearInterval(timer);
  }, [principalId, refresh]);

  useEffect(() => {
    if (principalId !== 'root' || wireState !== 'open') return undefined;
    if (hasConnectedRef.current) void refresh(true);
    hasConnectedRef.current = true;
    return undefined;
  }, [principalId, refresh, wireState]);

  useEffect(() => {
    if (principalId !== 'root' || !ACTIVE_NODE_UPDATE_STATES.has(value?.status)) return undefined;
    const timer = globalThis.setInterval(() => { void refresh(false); }, 1_000);
    return () => globalThis.clearInterval(timer);
  }, [principalId, refresh, value?.status]);

  const start = useCallback(() => {
    if (principalId !== 'root') {
      const error = new Error('当前账号无权升级节点');
      error.code = 'permission_denied';
      return Promise.reject(error);
    }
    const current = valueRef.current;
    if (current?.status === 'unsupported' || current?.status === 'unavailable') {
      const error = new Error(current.detail || NODE_UPDATE_UNAVAILABLE_DETAIL);
      error.code = 'update_unavailable';
      error.status = current.error_status || 503;
      return Promise.reject(error);
    }
    if (!current || current.available !== true) {
      const error = new Error('节点升级状态尚未确认');
      error.code = 'update_not_available';
      return Promise.reject(error);
    }
    if (ACTIVE_NODE_UPDATE_STATES.has(current.status)) return Promise.resolve(current);
    if (startInFlightRef.current) return startInFlightRef.current;

    if (mountedRef.current) setPending(true);
    const request = requestNodeUpdate('/api/update', { method: 'POST' })
      .then((next) => {
        const projected = projectNodeUpdate(next);
        valueRef.current = projected;
        if (mountedRef.current) setValue(projected);
        return projected;
      })
      .catch((error) => {
        const currentValue = valueRef.current;
        const projected = error?.status === 401 || error?.status === 403 || error?.status === 503
          ? unavailableNodeUpdate(currentValue, error)
          : {
            ...(currentValue || {}),
            available: currentValue?.available === true,
            status: 'failed',
            detail: error.detail || error.message,
          };
        valueRef.current = projected;
        if (mountedRef.current) setValue(projected);
        throw error;
      })
      .finally(() => {
        if (startInFlightRef.current === request) startInFlightRef.current = null;
        if (mountedRef.current) setPending(false);
      });
    startInFlightRef.current = request;
    return request;
  }, [principalId]);

  return useMemo(() => Object.freeze({
    active: ACTIVE_NODE_UPDATE_STATES.has(value?.status),
    pending,
    refresh,
    start,
    value,
  }), [pending, refresh, start, value]);
}

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

function writeRoute(channelId, view, replace = false, focus = null, contextEntry = false) {
  if (!channelId || !globalThis.history) return;
  const suffix = focus?.type && focus?.key
    ? `?focus=${encodeURIComponent(`${focus.type}:${focus.key}`)}`
    : '';
  const currentState = globalThis.history.state;
  const routeState = currentState && typeof currentState === 'object' ? currentState : {};
  globalThis.history[replace ? 'replaceState' : 'pushState'](
    {
      ...routeState,
      atollContextEntry: contextEntry === true,
      atollRoute: {
        channelId: String(channelId),
        view: String(view),
        focus: focus?.type && focus?.key
          ? { type: String(focus.type), key: String(focus.key) }
          : null,
      },
    },
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
  // Files visibility is a channel-scoped navigation fact just like terminal
  // visibility. The feature's directory/selection lifetime stays in
  // useAttachmentTransactions; this set only decides which existing Files
  // surface is selected when a channel is re-entered.
  const initialFileChannels = initialRef.current.view === 'files' && initialRef.current.channelId
    ? new Set([initialRef.current.channelId])
    : new Set();
  const fileChannelsRef = useRef(initialFileChannels);
  const [fileChannels, setFileChannels] = useState(() => new Set(initialFileChannels));
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
  const rememberFilesChannel = useCallback((channelId, open) => {
    if (!channelId) return;
    const current = fileChannelsRef.current;
    const has = current.has(channelId);
    if (has === open) return;
    const next = new Set(current);
    if (open) next.add(channelId);
    else next.delete(channelId);
    fileChannelsRef.current = next;
    setFileChannels(next);
  }, []);
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
    // A retired profile can remain in the last directory snapshot while the
    // access owner is publishing the terminal fact.  It is not a selectable
    // shell channel during that handoff: keeping it here leaves the active id
    // apparently valid and lets a right panel render with a null channel.
    const visible = rows.filter((row) => {
      const state = accessRef.current?.state?.(row.id);
      return row?.status !== 'retired'
        && row?.access !== 'retired'
        && state?.existence !== 'retired';
    });
    return [...visible].sort((left, right) => {
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
      if (!next) return;
      const hasValidRequest = requested?.id === next.id;
      const nextFocus = hasValidRequest ? initialRef.current.focus : null;
      // A stale/unknown URL is only a channel selection request. Its Files
      // view must not leak into the first valid channel selected from the
      // current directory/world.
      const nextView = hasValidRequest ? activeViewRef.current : 'conversation';
      commitActiveChannel(next.id);
      commitActiveView(nextView);
      commitFocus(nextFocus);
      writeRoute(next.id, nextView, true, nextFocus);
      if (activeChannelId) onSelect(next.id);
    }
  }, [accessRef, activeChannelId, channels, commitActiveChannel, commitActiveView, commitFocus, onNotice, onSelect]);

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
    if (!fileChannels.size) return;
    const next = new Set([...fileChannels].filter((channelId) => available.has(channelId)));
    if (next.size !== fileChannels.size) {
      fileChannelsRef.current = next;
      setFileChannels(next);
    }
  }, [channels, fileChannels]);

  useEffect(() => {
    const receiveRoute = () => {
      const route = readInitialRoute();
      if (route.channelId && channels.some((row) => row.id === route.channelId)) {
        const changedChannel = route.channelId !== activeChannelRef.current;
        if (activeViewRef.current === 'files' && activeChannelRef.current) {
          rememberFilesChannel(activeChannelRef.current, true);
        }
        if (route.view === 'files') rememberFilesChannel(route.channelId, true);
        else if (route.view === 'conversation') rememberFilesChannel(route.channelId, false);
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
  }, [channels, commitActiveChannel, commitActiveView, commitFocus, onSelect, rememberFilesChannel]);

  const select = useCallback((channelId) => {
    // The boolean is only an acceptance signal for shell handoff gates;
    // activeChannelRef/state remains the sole selection authority.
    if (!channelId || channelId === activeChannelRef.current) return false;
    const originChannelId = activeChannelRef.current;
    if (activeViewRef.current === 'files') rememberFilesChannel(originChannelId, true);
    // Tasks remains the existing cross-channel primary view. Files is the
    // channel-scoped exception: an already-open target restores Files, while
    // an unseen target stays on the conversation surface.
    const nextView = activeViewRef.current === 'tasks'
      ? 'tasks'
      : fileChannelsRef.current.has(channelId) ? 'files' : 'conversation';
    commitActiveChannel(channelId);
    commitActiveView(nextView);
    commitFocus(null);
    onSelect(channelId);
    writeRoute(channelId, nextView, true, null, false);
    return true;
  }, [commitActiveChannel, commitActiveView, commitFocus, onSelect, rememberFilesChannel]);
  const setActiveView = useCallback((view) => {
    if (!['conversation', 'files', 'tasks'].includes(view)) return;
    const channelId = activeChannelRef.current;
    let nextView = view;
    if (view === 'tasks') {
      if (activeViewRef.current === 'files' && channelId) {
        rememberFilesChannel(channelId, true);
        filesReturnIntentRef.current = channelId;
      }
    } else if (view === 'files') {
      // Opening or explicitly staying on Files is a new primary intent.
      rememberFilesChannel(channelId, true);
      filesReturnIntentRef.current = null;
    } else if (filesReturnIntentRef.current === channelId) {
      // The Dynamic tab is the return edge for a temporary Tasks excursion.
      nextView = 'files';
      filesReturnIntentRef.current = null;
    } else {
      if (activeViewRef.current === 'files') rememberFilesChannel(channelId, false);
      filesReturnIntentRef.current = null;
    }
    commitActiveView(nextView);
    commitFocus(null);
    writeRoute(channelId, nextView, true, null, false);
  }, [commitActiveView, commitFocus, rememberFilesChannel]);
  const setFocus = useCallback((nextFocus) => {
    const normalized = nextFocus?.type && nextFocus?.key
      ? parseRouteFocus(`${nextFocus.type}:${nextFocus.key}`)
      : null;
    commitFocus(normalized);
    // A focused Context is the only user navigation that opens a new browser
    // entry. Clearing focus is an ordinary route projection and replaces the
    // current Context entry, so Back never reopens a panel the user closed.
    writeRoute(
      activeChannelRef.current,
      activeViewRef.current,
      normalized == null,
      normalized,
      normalized != null,
    );
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
      fileChannelsRef.current = new Set();
      setFileChannels((current) => (current.size ? new Set() : current));
      // An empty authoritative directory is a world/replacement boundary,
      // not a temporary absence of rows. Retire the old channel/view
      // synchronously so a subsequent valid channel cannot inherit Files.
      commitActiveChannel('');
      commitActiveView('conversation');
      commitFocus(null);
    }
    setProfiles(next);
  }, [commitActiveChannel, commitActiveView, commitFocus]);
  const clear = useCallback(() => {
    filesReturnIntentRef.current = null;
    fileChannelsRef.current = new Set();
    setFileChannels(new Set());
    setProfiles(new Map());
    setTerminalChannels(new Set());
    commitActiveChannel('');
    commitActiveView('conversation');
    commitFocus(null);
    setRevision((value) => value + 1);
  }, [commitActiveChannel, commitActiveView, commitFocus]);

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

export function useWireSessionPort({ principalId = '' } = {}) {
  const [state, setState] = useState('closed');
  const [incompatible, setIncompatible] = useState(null);
  const update = useNodeUpdate({ principalId, wireState: state });
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
    update,
    wireRef,
  }), [close, incompatible, state, update]);
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
    let rosterAuthority = null;
    // A lifecycle callback belongs to the transport generation that emitted
    // it.  The wire normally serializes these callbacks, but a browser can
    // deliver a late close/error from an obsolete socket after its successor
    // is already open.  Such a callback must not revoke the successor token.
    let lifecycleGeneration = 0;
    let versionBlocked = false;
    const acceptsLifecycle = (detail) => {
      const nextGeneration = Number(detail?.generation);
      if (!Number.isSafeInteger(nextGeneration) || nextGeneration <= 0) return true;
      if (lifecycleGeneration > 0 && nextGeneration < lifecycleGeneration) return false;
      lifecycleGeneration = Math.max(lifecycleGeneration, nextGeneration);
      return true;
    };
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
        if (!acceptsLifecycle(detail)) return undefined;
        attachedGeneration = Number.isSafeInteger(nextGeneration) && nextGeneration > 0
          ? nextGeneration
          : 0;
        // Membership is not current until this attach receipt. Fence cached
        // self/OBS work first, then issue one opaque authority token that
        // every current attach callback must carry back to the roster owner.
        roster?.close();
        const sameServerWorld = commitServerWorld(detail?.boot);
        onServerWorld(String(detail?.boot || readServerWorld()));
        if (!sameServerWorld) {
          access.reset();
          roster?.reset();
          rosterAuthority = roster?.attach?.(nextGeneration, detail?.memberships) || null;
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
        rosterAuthority = roster?.attach?.(nextGeneration, detail?.memberships) || null;
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
        if (!acceptsLifecycle(detail)) return;
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
          rosterAuthority = null;
          access.wire('disconnected');
          stopIncompatibleFeed(detail?.generation);
          flushSync(() => setState('incompatible'));
          setIncompatible((current) => current || detail || {});
        } else if (state === 'attached') {
          if (!rosterAuthority || rosterAuthority.generation !== Number(detail?.generation)) {
            rosterAuthority = roster?.attach?.(detail?.generation, detail?.memberships) || null;
          }
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
              if (!roster?.noteSelf(entry.channel_id, entry.actor_id, rosterAuthority)) continue;
              reconcileIdentity(entry.channel_id, entry.actor_id);
            }
            for (const channelId of memberedBefore) {
              if (access.state(channelId)?.relationship !== 'member') {
                roster?.clearSelf(channelId, rosterAuthority);
              }
            }
          }
          flushSync(() => setState('open'));
          if (attachedOnce) scheduleAccessRefresh();
          attachedOnce = true;
        } else if (state === 'disconnected') {
          agentActivityRef.current.disconnect();
          roster?.close();
          rosterAuthority = null;
          disconnectHistory(detail?.generation);
        } else if (state === 'reconnecting') {
          agentActivityRef.current.disconnect();
          roster?.close();
          rosterAuthority = null;
          access.wire('disconnected');
          flushSync(() => setState('reconnecting'));
        } else if (state === 'closed') {
          agentActivityRef.current.disconnect();
          roster?.close();
          rosterAuthority = null;
          access.wire('disconnected');
          flushSync(() => setState('closed'));
        } else if (state === 'open') {
          // OPEN precedes the next attach receipt. It is not an authority
          // seam, so retained self must remain hidden until attach restores it.
          roster?.close();
          rosterAuthority = null;
          flushSync(() => setState((current) => current === 'open' ? current : 'connecting'));
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
      rosterAuthority = null;
      cancelFeedTask(ownedWire, ownedGeneration);
      if (obsRef.current === obs) obsRef.current = null;
      if (accessRef.current === access) accessRef.current = null;
      if (wireRef.current === ownedWire) wireRef.current = null;
    };
  }, [accessRef, accessRefreshActionsRef, activeChannelRef, agentActivityRef, bumpAccess, cancelFeedTask, disconnectHistory, displayError, enqueueFeed, expireSession, finishHistoryPage, finishLiveCheckpoint, incompatibleEpochRef, incompatibleRef, obsRef, onServerWorld, onWorldChanged, prepareLocalReplica, principalId, reconcileIdentity, refreshHistoryChannel, resetSubmissionWorld, resumeLocalReplica, rosterRef, setActiveChannelId, setChannels, setHistoryGrants, setIncompatible, setState, setTopError, stopIncompatibleFeed, wireRef]);

  return accessRefreshActionsRef;
}
