import { argsOf } from '../protocol/envelope.js';
import { TYPES } from '../protocol/vocab.js';

// One sub agent or background command is one task for its whole life, but the
// call it reports under can change: a background agent resumed by SendMessage
// reports its later progress and its end under that SendMessage's call. The
// task id is the identity; a step that carries only a call (an older step, or
// a sub agent's own words) is mapped to the task that call belongs to.
export function subTaskIdentity(envelopes) {
  const callTask = new Map();
  for (const envelope of envelopes) {
    if (envelope?.type !== TYPES.agentTask) continue;
    const { call_id: call, task_id: task } = argsOf(envelope) || {};
    if (call && task) callTask.set(`${envelope.sender?.id || ''}\u0000${call}`, String(task));
  }
  return (envelope) => {
    const sender = String(envelope?.sender?.id || '');
    const { call_id: call, task_id: task } = argsOf(envelope) || {};
    const id = task || callTask.get(`${sender}\u0000${call}`) || `call:${call || envelope?.id || ''}`;
    return `${sender}\u0000${id}`;
  };
}

function taskSteps(state) {
  const steps = [];
  for (const envelope of state?.rows?.values?.() || []) {
    if (envelope?.type === TYPES.agentTask) steps.push(envelope);
  }
  return steps;
}

// The step that ended each task, by identity: where a task's end is, wherever
// in the channel it was written.
export function subTaskEnds(state) {
  const steps = taskSteps(state);
  const identity = subTaskIdentity(steps);
  const ends = new Map();
  for (const envelope of steps) {
    const phase = argsOf(envelope)?.phase;
    if (phase === 'completed' || phase === 'failed') ends.set(identity(envelope), envelope);
  }
  return { identity, ends };
}

// Background work agents set off — sub agents and background commands — that
// has not reported its end. Newest first. requestId is the message the work
// was first set off for, when the agent knew it; that is where it is read in
// context.
export function runningBackgroundTasks(state, actorId = '') {
  const steps = taskSteps(state);
  const identity = subTaskIdentity(steps);
  const tasks = new Map();
  for (const envelope of steps) {
    const sender = String(envelope.sender?.id || '');
    if (actorId && sender !== actorId) continue;
    const args = argsOf(envelope) || {};
    if (!args.call_id && !args.task_id) continue;
    const key = identity(envelope);
    const task = tasks.get(key) || {
      key, callId: String(args.call_id || ''), sender, title: '', kind: '', phase: '', lastText: '',
      startedAt: Number(envelope.ts) || 0, updatedAt: 0, requestId: '', seenStart: false,
    };
    if (args.phase === 'started') task.seenStart = true;
    if (args.title) task.title = args.title;
    if (args.kind) task.kind = args.kind;
    if (args.phase) task.phase = args.phase;
    if ((args.phase === 'progress' || args.phase === 'message') && args.text) task.lastText = String(args.text);
    if (envelope.parent_id && !task.requestId) task.requestId = String(envelope.parent_id);
    task.updatedAt = Math.max(task.updatedAt, Number(envelope.ts) || 0);
    tasks.set(key, task);
  }
  return [...tasks.values()]
    // Running needs a start on record: steps of a task whose start cannot be
    // tied to them (older records, before tasks carried their id) say nothing
    // about whether it still runs.
    .filter((task) => task.seenStart && task.phase !== 'completed' && task.phase !== 'failed')
    .sort((left, right) => right.startedAt - left.startedAt);
}
