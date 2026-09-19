import { selectTimelineItems } from './conversation-presentation.js';
import { argsOf } from '../protocol/envelope.js';

function entryEnvelope(entry) {
  if (entry?.kind === 'turn') return entry.turn?.request || null;
  return entry?.envelope || null;
}

function envelopeText(envelope) {
  const body = argsOf(envelope);
  return String(body.text || body.title || body.description || body.detail || body.message || '').trim();
}

function entryText(entry) {
  if (entry?.kind !== 'turn') return envelopeText(entry?.envelope);
  const turn = entry.turn || {};
  return [
    turn.request,
    ...(turn.provisional || []).map((row) => row?.envelope),
    turn.terminal,
  ].map(envelopeText).filter(Boolean).join('\n');
}

function entrySearchRow(entry, channel) {
  const envelope = entryEnvelope(entry);
  if (!envelope?.id) return null;
  const text = entryText(entry);
  return Object.freeze({
    key: `message:${channel.id}:${envelope.id}`,
    id: envelope.id,
    kind: 'message',
    objectType: 'message',
    title: envelopeText(envelope) || envelope.type || envelope.id,
    text,
    subtitle: envelope.type || '',
    channelId: channel.id,
    channelName: channel.qualified_name || channel.name || channel.id,
    source: Object.freeze({ kind: 'message', channelId: channel.id, messageId: envelope.id }),
  });
}

function visitEntries(entries, visit) {
  for (const entry of entries || []) {
    visit(entry);
    visitEntries(entry?.thread, visit);
  }
}

function channelCanExposeContent(channel) {
  if (!channel?.access) return Boolean(channel?.id);
  return String(channel.access).startsWith('member_') || String(channel.access).startsWith('observer_');
}

function ownedRows(input) {
  if (input instanceof Map) {
    return [...input].flatMap(([channelId, value]) => Array.isArray(value)
      ? value.map((row) => ({ row, channelId }))
      : [{ row: value, channelId: value?.channelId || '' }]);
  }
  return [...(input || [])].map((row) => ({ row, channelId: row?.channelId || '' }));
}

function taskSearchRow(item, fallbackChannelId, channelById) {
  const channelId = String(item?.channelId || fallbackChannelId || '');
  const channel = channelById.get(channelId);
  const id = String(item?.key || item?.id || '');
  if (!id || !channelCanExposeContent(channel)) return null;
  return Object.freeze({
    key: `task:${channelId}:${id}`,
    id,
    kind: 'task',
    objectType: 'task',
    title: String(item.title || item.text || '未命名任务'),
    text: [item.description, item.waitingFor].filter(Boolean).join('\n'),
    subtitle: String(item.state || ''),
    channelId,
    channelName: channel.qualified_name || channel.name || channelId,
    source: Object.freeze({ kind: 'task', channelId, taskId: id }),
  });
}

function fileSearchRow(entry, fallbackChannelId, channelById) {
  const channelId = String(entry?.channelId || fallbackChannelId || '');
  const channel = channelById.get(channelId);
  const id = String(entry?.resourceId || entry?.path || entry?.key || '');
  if (entry?.kind !== 'file' || !id || !channelCanExposeContent(channel)) return null;
  return Object.freeze({
    key: `file:${channelId}:${id}`,
    id,
    kind: 'file',
    objectType: 'file',
    title: String(entry.name || id),
    subtitle: String(entry.mediaType || ''),
    channelId,
    channelName: channel.qualified_name || channel.name || channelId,
    source: Object.freeze({ kind: 'file', channelId, fileId: id }),
  });
}

// Pure query index over owner-provided snapshots. Optional task and file rows
// are indexed only when their owners supply them; this selector never fetches,
// caches, or reconstructs either corpus from conversation data.
export function selectFeatureSearchIndex({
  states = [],
  channels = [],
  rosters = new Map(),
  tasks = [],
  files = [],
} = {}) {
  const channelById = new Map((channels || []).map((channel) => [channel.id, channel]));
  const rows = (channels || []).filter(channelCanExposeContent).map((channel) => Object.freeze({
    key: `channel:${channel.id}`,
    id: channel.id,
    kind: 'channel',
    objectType: 'channel',
    title: channel.qualified_name || channel.name || channel.id,
    subtitle: channel.description || '',
    channelId: channel.id,
    channelName: channel.qualified_name || channel.name || channel.id,
    source: Object.freeze({ kind: 'channel', channelId: channel.id }),
  }));
  for (const [channelId, state] of states || []) {
    const channel = channelById.get(channelId);
    if (!channelCanExposeContent(channel)) continue;
    const projection = selectTimelineItems(state, { scope: 'all' });
    visitEntries(projection.items, (entry) => {
      const row = entrySearchRow(entry, channel);
      if (row) rows.push(row);
    });
  }
  for (const [channelId, actors] of rosters || []) {
    const channel = channelById.get(channelId);
    if (!channelCanExposeContent(channel)) continue;
    for (const actor of actors || []) {
      if (!actor?.id) continue;
      rows.push(Object.freeze({
        key: `actor:${channelId}:${actor.id}`,
        id: actor.id,
        kind: 'actor',
        objectType: 'actor',
        title: actor.name || actor.id,
        subtitle: actor.kind || '',
        actorId: actor.id,
        channelId,
        channelName: channel.qualified_name || channel.name || channelId,
        source: Object.freeze({ kind: 'actor', channelId, actorId: actor.id }),
      }));
    }
  }
  for (const { row, channelId } of ownedRows(tasks)) {
    const task = taskSearchRow(row, channelId, channelById);
    if (task) rows.push(task);
  }
  for (const { row, channelId } of ownedRows(files)) {
    const file = fileSearchRow(row, channelId, channelById);
    if (file) rows.push(file);
  }
  const unique = new Map(rows.map((row) => [row.key, row]));
  return Object.freeze([...unique.values()]);
}

function searchableText(row) {
  return [
    row?.title,
    row?.subtitle,
    row?.channelName,
    row?.channelId,
    row?.text,
    row?.name,
    row?.actorId,
  ].filter(Boolean).join('\n').toLocaleLowerCase();
}

function queryTerms(query) {
  return String(query || '')
    .trim()
    .toLocaleLowerCase()
    .split(/\s+/u)
    .filter(Boolean);
}

export function searchFeatureIndex(index = [], query = '', limit = 40) {
  const terms = queryTerms(query);
  if (!terms.length) return [];
  return index
    .flatMap((row, position) => {
      const haystack = searchableText(row);
      if (!terms.every((term) => haystack.includes(term))) return [];
      const title = String(row?.title || row?.name || '未命名结果').toLocaleLowerCase();
      const score = terms.reduce((total, term) => total
        + (title === term ? 8 : title.startsWith(term) ? 4 : title.includes(term) ? 2 : 1), 0);
      return [{ row, position, score }];
    })
    .sort((left, right) => right.score - left.score || left.position - right.position)
    .slice(0, Math.max(0, limit))
    .map(({ row }) => row);
}
