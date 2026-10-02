import { argsOf } from '../protocol/envelope.js';
import { TYPES } from '../protocol/vocab.js';

// Background work agents set off — sub agents and background commands — that
// has not reported its end, read from the channel's agent.task steps. Newest
// first. requestId is the message the work was set off for, when the agent
// knew it; that is where the work is read in context.
export function runningBackgroundTasks(state, actorId = '') {
  const tasks = new Map();
  for (const envelope of state?.rows?.values?.() || []) {
    if (envelope?.type !== TYPES.agentTask) continue;
    const sender = String(envelope.sender?.id || '');
    if (actorId && sender !== actorId) continue;
    const args = argsOf(envelope) || {};
    const callId = String(args.call_id || '');
    if (!callId) continue;
    const key = `${sender}\u0000${callId}`;
    const task = tasks.get(key) || {
      key, callId, sender, title: '', kind: '', phase: '', lastText: '',
      startedAt: Number(envelope.ts) || 0, updatedAt: 0, requestId: '',
    };
    if (args.title) task.title = args.title;
    if (args.kind) task.kind = args.kind;
    if (args.phase) task.phase = args.phase;
    if ((args.phase === 'progress' || args.phase === 'message') && args.text) task.lastText = String(args.text);
    if (envelope.parent_id && !task.requestId) task.requestId = String(envelope.parent_id);
    task.updatedAt = Math.max(task.updatedAt, Number(envelope.ts) || 0);
    tasks.set(key, task);
  }
  return [...tasks.values()]
    .filter((task) => task.phase !== 'completed' && task.phase !== 'failed')
    .sort((left, right) => right.startedAt - left.startedAt);
}
