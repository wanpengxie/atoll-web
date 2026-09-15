import { argsOf } from '../protocol/envelope.js';
import { TYPES } from '../protocol/vocab.js';

function finiteSeq(value) {
  const seq = Number(value || 0);
  return Number.isFinite(seq) && seq > 0 ? seq : 0;
}

function envelopeSeq(envelope) {
  return finiteSeq(envelope?.seq || envelope?._seq);
}

function turnBounds(entry) {
  const turn = entry?.turn || {};
  const seqs = [
    finiteSeq(entry?.seq),
    finiteSeq(turn.requestSeq),
    finiteSeq(turn.lastSeq),
    envelopeSeq(turn.request),
    finiteSeq(turn.terminalSeq),
    envelopeSeq(turn.terminal),
  ];
  for (const child of entry?.thread || []) {
    seqs.push(finiteSeq(child?.seq), finiteSeq(child?.turn?.requestSeq));
    seqs.push(envelopeSeq(child?.turn?.request), envelopeSeq(child?.turn?.terminal));
  }
  const present = seqs.filter(Boolean);
  const fallback = finiteSeq(entry?.seq);
  return {
    low: present.length ? Math.min(...present) : fallback,
    high: present.length ? Math.max(...present) : fallback,
  };
}

function entryIdentity(entry) {
  if (entry?.kind === 'turn') return entry.turn?.requestId || entry.turn?.request?.id || '';
  if (entry?.kind === 'narration') return `narration:${finiteSeq(entry.seq)}`;
  return entry?.envelope?.id || `${entry?.kind || 'entry'}:${finiteSeq(entry?.seq)}`;
}

function actorID(entry) {
  if (entry?.kind === 'turn') {
    return entry.turn?.request?.audience?.[0]
      || entry.turn?.terminal?.sender?.id
      || entry.turn?.request?.sender?.id
      || '';
  }
  return entry?.envelope?.sender?.id || '';
}

function layoutClass(entry) {
  if (entry?.kind === 'narration') return 'compact';
  const envelope = entry?.kind === 'turn' ? entry.turn?.request : entry?.envelope;
  const payload = argsOf(envelope);
  const text = String(payload?.text || payload?.body || '');
  const attachments = payload?.attachments || payload?.files || [];
  if (attachments.length || text.includes('```') || text.length > 1_200) return 'rich';
  if (entry?.kind === 'turn') return entry.turn?.terminal ? 'normal' : 'reserved';
  return text.length < 120 ? 'compact' : 'normal';
}

function settled(entry) {
  if (entry?.kind === 'turn') return Boolean(entry.turn?.terminal);
  if (entry?.kind === 'narration') return true;
  return argsOf(entry?.envelope)?.transient !== true;
}

// Presentation identity and revision are semantic facts. Array index, current
// filter and measured pixels never participate, so prepend and Surface remount
// cannot manufacture a new row.
function entryTimestamp(entry) {
  return Number(entry?.kind === 'turn' ? entry.turn?.request?.ts : entry?.kind === 'standalone' ? entry.envelope?.ts : 0) || 0;
}

function entryAuthor(entry) {
  return entry?.kind === 'turn' ? entry.turn?.request?.sender?.id : entry?.kind === 'standalone' ? entry.envelope?.sender?.id : '';
}

function entryEndAuthor(entry) {
  if (entry?.kind === 'turn') return entry.turn?.terminal?.sender?.id || entry.turn?.request?.sender?.id || '';
  return entry?.kind === 'standalone' ? entry.envelope?.sender?.id || '' : '';
}

function conversational(entry) {
  return entry?.kind === 'standalone'
    || (entry?.kind === 'turn' && ![TYPES.humanAsk, TYPES.humanApprove].includes(entry.turn?.request?.type));
}

function localDayKey(timestamp) {
  if (!timestamp) return '';
  const date = new Date(timestamp);
  return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
}

function continues(previous, current) {
  if (!conversational(previous) || !conversational(current)) return false;
  const delta = entryTimestamp(current) - entryTimestamp(previous);
  return Boolean(entryAuthor(current))
    && entryAuthor(current) === entryEndAuthor(previous)
    && delta >= 0
    && delta <= 5 * 60_000;
}

export function presentationRow(entry, { previous = null } = {}) {
  const bounds = entry?.kind === 'turn'
    ? turnBounds(entry)
    : { low: finiteSeq(entry?.seq), high: finiteSeq(entry?.seq) };
  return Object.freeze({
    id: entryIdentity(entry),
    seqLow: bounds.low,
    get seqHigh() { return entry?.kind === 'turn' ? turnBounds(entry).high : bounds.high; },
    kind: entry?.kind === 'narration' ? 'boundary' : entry?.kind === 'turn' ? 'turn' : 'notice',
    actorID: actorID(entry),
    timestamp: entryTimestamp(entry),
    dayKey: localDayKey(entryTimestamp(entry)),
    startsDay: Boolean(entryTimestamp(entry)) && localDayKey(entryTimestamp(entry)) !== localDayKey(entryTimestamp(previous)),
    continuation: continues(previous, entry),
    // Every content-changing ledger fact advances seqHigh. Local reading state
    // (folds, filters, panels) deliberately does not.
    get contentRevision() { return entry?.kind === 'turn' ? turnBounds(entry).high : bounds.high; },
    get layoutClass() { return layoutClass(entry); },
    get settled() { return settled(entry); },
    body: entry,
  });
}

export function projectPresentationRows(entries = []) {
  return entries.map((entry, index) => presentationRow(entry, { previous: entries[index - 1] || null }));
}

function rowSignature(row) {
  return [
    row.id,
    row.seqLow,
    row.seqHigh,
    row.kind,
    row.actorID,
    row.timestamp,
    row.dayKey,
    row.startsDay ? 1 : 0,
    row.continuation ? 1 : 0,
    row.contentRevision,
    row.layoutClass,
    row.settled ? 1 : 0,
  ].join('\u001f');
}

// Projection is incremental by semantic identity, not array position. A new
// request, prepend, filter change or terminal may require another ordered
// scan, but rows whose content and neighbour-derived presentation facts did
// not change retain the exact same object identity for the render adapter.
export function createPresentationProjector() {
  let cache = new Map();
  return Object.freeze({
    project(entries = []) {
      const next = new Map();
      const rows = entries.map((entry, index) => {
        const candidate = presentationRow(entry, { previous: entries[index - 1] || null });
        const signature = rowSignature(candidate);
        const cached = cache.get(candidate.id);
        const row = cached?.signature === signature ? cached.row : candidate;
        next.set(candidate.id, { row, signature });
        return row;
      });
      cache = next;
      return rows;
    },
    clear() { cache.clear(); },
    get size() { return cache.size; },
  });
}

export function presentationEntryId(entryOrRow) {
  return entryOrRow?.id || entryIdentity(entryOrRow);
}
