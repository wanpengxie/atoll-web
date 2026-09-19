import { selectTimelineItems } from './conversation-presentation.js';
import { argsOf } from '../protocol/envelope.js';

function entryEnvelope(entry) {
  if (entry?.kind === 'turn') return entry.turn?.request || null;
  return entry?.envelope || null;
}

function entrySearchRow(entry, channel) {
  const envelope = entryEnvelope(entry);
  if (!envelope?.id) return null;
  const body = argsOf(envelope);
  const text = String(body.text || body.title || body.description || body.detail || '').trim();
  return Object.freeze({
    key: `entry:${channel.id}:${envelope.id}`,
    id: envelope.id,
    kind: 'entry',
    objectType: entry.kind === 'turn' ? 'turn' : 'entry',
    title: text || envelope.type || envelope.id,
    text,
    subtitle: envelope.type || '',
    channelId: channel.id,
    channelName: channel.qualified_name || channel.name || channel.id,
    source: Object.freeze({ kind: 'conversation', channelId: channel.id, entryId: envelope.id }),
  });
}

function visitEntries(entries, visit) {
  for (const entry of entries || []) {
    visit(entry);
    visitEntries(entry?.thread, visit);
  }
}

// Pure query index over the currently installed, accessible Replica
// presentations. It never opens history, reads cache, or retains a second
// search corpus.
export function selectFeatureSearchIndex({ states = [], channels = [], rosters = new Map() } = {}) {
  const channelById = new Map((channels || []).map((channel) => [channel.id, channel]));
  const rows = (channels || []).map((channel) => Object.freeze({
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
    if (!channel || ['access_denied', 'retired'].includes(channel.access)) continue;
    const projection = selectTimelineItems(state, { scope: 'all' });
    visitEntries(projection.items, (entry) => {
      const row = entrySearchRow(entry, channel);
      if (row) rows.push(row);
    });
    for (const actor of rosters.get(channelId) || []) {
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
        source: Object.freeze({ kind: 'actor', channelId, actor }),
      }));
    }
  }
  return Object.freeze(rows);
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
