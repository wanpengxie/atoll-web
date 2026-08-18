export const WORKSPACE_VIEWS = ['dynamic', 'artifacts', 'tasks'];
export const FOCUS_TYPES = ['turn', 'artifact', 'work_item', 'participant', 'channel'];

function safeDecode(value) {
  try { return decodeURIComponent(value); }
  catch { return ''; }
}

export function isWorkspaceView(value) {
  return WORKSPACE_VIEWS.includes(value);
}

export function parseWorkspaceFocus(value) {
  if (!value) return null;
  const separator = value.indexOf(':');
  if (separator < 1) return null;
  const type = value.slice(0, separator);
  const key = value.slice(separator + 1);
  if (!FOCUS_TYPES.includes(type) || !key) return null;
  return { type, key };
}

export function parseWorkspaceHash(hash = '') {
  const source = String(hash).replace(/^#/, '');
  const [pathname, query = ''] = source.split('?');
  const match = pathname.match(/^\/channels\/([^/]+)\/([^/]+)$/);
  if (!match) return { channelId: '', view: 'dynamic', focus: null, valid: false };
  const channelId = safeDecode(match[1]);
  const view = safeDecode(match[2]);
  const params = new URLSearchParams(query);
  const focus = parseWorkspaceFocus(params.get('focus'));
  return {
    channelId,
    view: isWorkspaceView(view) ? view : 'dynamic',
    focus,
    valid: Boolean(channelId) && isWorkspaceView(view),
  };
}

export function buildWorkspaceHash({ channelId, view = 'dynamic', focus = null }) {
  if (!channelId) return '#/';
  const safeView = isWorkspaceView(view) ? view : 'dynamic';
  const path = `#/channels/${encodeURIComponent(channelId)}/${safeView}`;
  if (!focus || !FOCUS_TYPES.includes(focus.type) || !focus.key) return path;
  return `${path}?focus=${encodeURIComponent(`${focus.type}:${focus.key}`)}`;
}

export function writeWorkspaceRoute(route, { replace = false, contextEntry = false } = {}) {
  const method = replace ? 'replaceState' : 'pushState';
  window.history[method]({ ...window.history.state, atollContextEntry: contextEntry }, '', buildWorkspaceHash(route));
}
