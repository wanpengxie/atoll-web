import { apply, createChannelState } from './fold.js';

function numeric(value) {
  const result = Number(value);
  return Number.isSafeInteger(result) && result >= 0 ? result : 0;
}

function insertInterval(intervals, lowSeq, highSeq = lowSeq) {
  if (!lowSeq || highSeq < lowSeq) return intervals;
  const ordered = [...intervals, { lowSeq, highSeq }].sort((left, right) => left.lowSeq - right.lowSeq);
  const merged = [];
  for (const interval of ordered) {
    const previous = merged.at(-1);
    if (previous && interval.lowSeq <= previous.highSeq + 1) previous.highSeq = Math.max(previous.highSeq, interval.highSeq);
    else merged.push({ ...interval });
  }
  return merged;
}

function rowBounds(state) {
  if (!state?.rows?.size) return { lowSeq: 0, highSeq: 0 };
  let lowSeq = Number.POSITIVE_INFINITY;
  let highSeq = 0;
  for (const seq of state.rows.keys()) {
    lowSeq = Math.min(lowSeq, numeric(seq));
    highSeq = Math.max(highSeq, numeric(seq));
  }
  return { lowSeq: Number.isFinite(lowSeq) ? lowSeq : 0, highSeq };
}

// The single in-memory owner for one browser replica. Cache/network/live are
// provenance of a commit, not separate stores. The history scheduler may plan
// range work, but only this object owns materialized rows and their revisions.
export function createChannelReplicaStore() {
  let states = new Map();
  const records = new Map();

  function ensure(channelId) {
    let record = records.get(channelId);
    if (record) return record;
    const state = createChannelState(channelId);
    record = {
      channelId,
      state,
      revision: 0,
      headSeq: 0,
      durableCoverage: [],
      materializedCoverage: [],
    };
    records.set(channelId, record);
    states.set(channelId, state);
    return record;
  }

  function commit(row, selfId = '', transform = (value) => value) {
    const channelId = row?.channel_id;
    const seq = numeric(row?.seq);
    if (!channelId || !seq) return { accepted: false, record: null };
    const record = ensure(channelId);
    if (record.state.rows.has(seq)) return { accepted: false, record };
    apply(record.state, transform(row), selfId);
    if (!record.state.rows.has(seq)) return { accepted: false, record };
    record.revision += 1;
    record.headSeq = Math.max(record.headSeq, seq);
    record.materializedCoverage = insertInterval(record.materializedCoverage, seq);
    return { accepted: true, record };
  }

  function installMeta(channelId, { headSeq = 0, coverage = [] } = {}) {
    const record = ensure(channelId);
    record.headSeq = Math.max(record.headSeq, numeric(headSeq));
    record.durableCoverage = (Array.isArray(coverage) ? coverage : []).reduce((all, entry) => (
      insertInterval(all, numeric(entry?.lowSeq), numeric(entry?.highSeq))
    ), []);
    return record;
  }

  function afterTrim(channelId) {
    const record = records.get(channelId);
    if (!record) return null;
    record.materializedCoverage = [...record.state.rows.keys()]
      .map(numeric)
      .filter(Boolean)
      .sort((left, right) => left - right)
      .reduce((all, seq) => insertInterval(all, seq), []);
    record.revision += 1;
    return record;
  }

  function reset() {
    states = new Map();
    records.clear();
  }

  return {
    ensure,
    commit,
    installMeta,
    afterTrim,
    reset,
    states: () => states,
    state: (channelId) => records.get(channelId)?.state,
    record: (channelId) => records.get(channelId),
    revision: (channelId) => records.get(channelId)?.revision || 0,
    hasRow: (channelId, seq) => records.get(channelId)?.state.rows.has(numeric(seq)) === true,
    visibleOldest: (channelId) => rowBounds(records.get(channelId)?.state).lowSeq,
  };
}
