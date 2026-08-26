import { FINAL } from '../protocol/envelope.js';
import { TYPES } from '../protocol/vocab.js';

// Only user-visible Agent work owns an activity timer. Control/configuration
// words (agent.context/select/describe, etc.) are deliberately absent: they
// may run on every connection and must never manufacture "Agent is working"
// chrome in the channel rail.
const ACTIVITY_TYPES = new Set([
  TYPES.agentAsk,
  TYPES.agentQueue,
  TYPES.agentCompact,
  TYPES.agentNew,
  TYPES.agentReplace,
  TYPES.agentSteer,
]);

function entryKey(channelId, requestId) {
  return `${channelId}\u0000${requestId}`;
}

function timestamp(envelope, fallback) {
  const value = new Date(envelope?.ts).getTime();
  return Number.isFinite(value) ? value : fallback;
}

function isRunningProgress(envelope) {
  return envelope?.kind === 'response'
    && ACTIVITY_TYPES.has(envelope.type)
    && (envelope.payload?.status === 'processing' || Boolean(envelope.payload?.process));
}

function isTerminalActivity(envelope) {
  return envelope?.kind === 'response'
    && ACTIVITY_TYPES.has(envelope.type)
    && FINAL.has(envelope.payload?.status);
}

function cloneEntry(entry) {
  return {
    channelId: entry.channelId,
    requestId: entry.requestId,
    agentId: entry.agentId,
    type: entry.type,
    startedAt: entry.startedAt,
    updatedAt: entry.updatedAt,
    settledAt: entry.settledAt || 0,
    outcome: entry.outcome || '',
  };
}

// This is intentionally an in-memory, live-evidence projection. The ledger
// remains the durable source for the conversation, but an unterminated turn in
// semantic history is not proof that its old actor incarnation is still alive.
export function createAgentActivityTracker({ onChange = () => {}, now = () => Date.now() } = {}) {
  const entries = new Map();
  let boot = '';
  let generation = 0;
  let connected = false;

  function changed() {
    onChange();
  }

  function attach(detail = {}) {
    const nextBoot = String(detail.boot || '');
    const nextGeneration = Number(detail.generation || 0);
    let dirty = false;
    if (boot && nextBoot && boot !== nextBoot) {
      entries.clear();
      dirty = true;
    }
    if (nextBoot && boot !== nextBoot) boot = nextBoot;
    if (!connected || generation !== nextGeneration) dirty = true;
    generation = nextGeneration;
    connected = true;
    if (dirty) changed();
  }

  function disconnect() {
    if (!connected) return;
    connected = false;
    changed();
  }

  function observe(payload = {}, context = {}) {
    const envelope = payload.envelope;
    const channelId = String(payload.channel_id || envelope?.channel_id || '');
    const requestId = String(envelope?.parent_id || '');
    if (!channelId || !requestId) return false;
    const key = entryKey(channelId, requestId);
    const source = payload.source || 'live';
    const live = source === 'live';

    if (isTerminalActivity(envelope)) {
      const current = entries.get(key);
      // History may reconcile an activity retained across a reconnect, but it
      // may never create a red dot for an old turn the browser never saw run.
      if (!current || current.state === 'settled') return false;
      const at = timestamp(envelope, now());
      entries.set(key, {
        ...current,
        state: 'settled',
        updatedAt: at,
        settledAt: at,
        outcome: envelope.payload?.status || '',
      });
      changed();
      return true;
    }

    if (!live || !connected || Number(payload.generation || 0) !== generation || !isRunningProgress(envelope)) return false;
    const agentId = String(envelope.sender?.id || '');
    if (!agentId) return false;
    const at = timestamp(envelope, now());
    const current = entries.get(key);
    if (current?.state === 'settled') return false;
    const process = envelope.payload?.process;
    const processStarted = process?.kind === 'turn' && process?.phase === 'started';
    const contextStartedAt = new Date(context.startedAt).getTime();
    const next = {
      state: 'active',
      channelId,
      requestId,
      agentId,
      type: envelope.type,
      generation,
      startedAt: current?.startedAt || (Number.isFinite(contextStartedAt) ? contextStartedAt : at),
      updatedAt: at,
      settledAt: 0,
      outcome: '',
    };
    if (processStarted && current?.startedAt) next.startedAt = Math.min(current.startedAt, at);
    entries.set(key, next);
    // Repeated progress updates do not change the chrome shape. A reconnect
    // confirmation does, because it makes an old hidden activity live again.
    if (!current || current.generation !== generation || current.agentId !== agentId) changed();
    return true;
  }

  function acknowledge(channelId, agentId) {
    let dirty = false;
    for (const [key, entry] of entries) {
      if (entry.state === 'settled' && entry.channelId === channelId && entry.agentId === agentId) {
        entries.delete(key);
        dirty = true;
      }
    }
    if (dirty) changed();
    return dirty;
  }

  function clear() {
    const dirty = entries.size > 0 || connected || boot || generation;
    entries.clear();
    boot = '';
    generation = 0;
    connected = false;
    if (dirty) changed();
  }

  function snapshot() {
    const byChannel = {};
    for (const entry of entries.values()) {
      const visibleActive = entry.state === 'active' && connected && entry.generation === generation;
      if (!visibleActive && entry.state !== 'settled') continue;
      const channel = byChannel[entry.channelId] || { active: [], agents: {} };
      byChannel[entry.channelId] = channel;
      const agent = channel.agents[entry.agentId] || { active: 0, settled: 0, state: '' };
      channel.agents[entry.agentId] = agent;
      if (visibleActive) {
        channel.active.push(cloneEntry(entry));
        agent.active += 1;
      } else {
        agent.settled += 1;
      }
    }
    for (const channel of Object.values(byChannel)) {
      channel.active.sort((left, right) => right.updatedAt - left.updatedAt || right.startedAt - left.startedAt);
      for (const agent of Object.values(channel.agents)) agent.state = agent.active > 0 ? 'active' : 'settled';
    }
    return { boot, generation, connected, byChannel };
  }

  return { attach, disconnect, observe, acknowledge, clear, snapshot };
}

export function agentActivityDuration(start, current = Date.now()) {
  const started = new Date(start).getTime();
  if (!Number.isFinite(started)) return '';
  const seconds = Math.max(0, Math.floor((current - started) / 1000));
  const minutes = Math.floor(seconds / 60);
  return `${String(minutes).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
}
