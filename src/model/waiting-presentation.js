import { agentMessageStage, isAgentMessageType } from './agent-control.js';
import { isRequestClosed } from './fold.js';
import { argsOf } from '../protocol/envelope.js';
import { TYPES } from '../protocol/vocab.js';

// Replica is the sole lifecycle owner. Waiting is an immutable presentation
// selected from its canonical folded turns after Scheduler proves the attached
// control tail current; it stores no parallel request or terminal state.
export function selectWaitingPresentation(state, {
  controlCurrent = false,
  editingTargetId = '',
  localTurns = [],
  continuityIDs = new Set(),
} = {}) {
  const turns = [];
  const presented = new Set();
  if (controlCurrent === true) {
    for (const turn of state?.turns?.values?.() || []) {
      if (turn?.requestId === editingTargetId || agentMessageStage(turn) !== 'queued') continue;
      turns.push(turn);
      presented.add(turn.requestId);
    }
  }
  // A locally durable agent request already has its permanent identity and a
  // single presentation destination. Keep it in Waiting from the outbox
  // commit onward; sending it through the list first creates a fake tail
  // extent which is removed again as soon as the canonical queued fact lands.
  for (const turn of localTurns) {
    if (!turn?.requestId || turn.requestId === editingTargetId || presented.has(turn.requestId)) continue;
    // The absence of a canonical turn is not evidence that the work is still
    // waiting. The memory window evicts closed turns, and the Replica keeps the
    // closure that proves it; without this question the outbox local echo puts
    // finished work back into Waiting for as long as the row stays uncollected.
    if (isRequestClosed(state, turn.requestId)) continue;
    const canonical = state?.turns?.get?.(turn.requestId);
    // Feed reconciliation can remove the outbox row one commit before the
    // actor's queued progress arrives. Once the canonical request exists, use
    // that request object under the same key instead of mounting a second copy.
    if (canonical && agentMessageStage(canonical) === '') turns.push({
      ...canonical,
      waitingPresentation: 'confirming',
    });
    else if (!canonical) turns.push(turn);
    else continue;
    presented.add(turn.requestId);
  }
  // Preserve only an already-presented local request across the narrow
  // request->position gap. This never guesses that an arbitrary open request
  // is queued: the id must have been a durable local Waiting presentation in
  // the previous committed render.
  for (const requestId of continuityIDs || []) {
    if (!requestId || requestId === editingTargetId || presented.has(requestId)) continue;
    if (isRequestClosed(state, requestId)) continue;
    const canonical = state?.turns?.get?.(requestId);
    if (!canonical || canonical.terminal || agentMessageStage(canonical) !== '') continue;
    turns.push({ ...canonical, waitingPresentation: 'confirming' });
    presented.add(requestId);
  }
  turns.sort((left, right) => {
    if (Boolean(left.local) !== Boolean(right.local)) return left.local ? 1 : -1;
    const leftTarget = argsOf(left.request).target;
    const rightTarget = argsOf(right.request).target;
    const leftSeq = left.request.type === TYPES.agentReplace
      ? state?.turns?.get?.(leftTarget)?.requestSeq || left.requestSeq
      : left.requestSeq;
    const rightSeq = right.request.type === TYPES.agentReplace
      ? state?.turns?.get?.(rightTarget)?.requestSeq || right.requestSeq
      : right.requestSeq;
    return leftSeq - rightSeq;
  });
  return Object.freeze(turns);
}

const LOCAL_WAITING_STATES = new Set(['queued', 'transmitting', 'accepted', 'delayed', 'uncertain']);

export function selectLocalWaitingTurns(submissions = [], selfId = '') {
  return Object.freeze((submissions || []).flatMap((submission) => {
    const frame = submission?.frame || {};
    if (!submission?.messageId
      || !LOCAL_WAITING_STATES.has(submission.state)
      || frame.kind !== 'request'
      || !isAgentMessageType(frame.msg_type)
      || frame.audience?.length !== 1) return [];
    const request = {
      id: submission.messageId,
      type: frame.msg_type,
      kind: 'request',
      payload: frame.payload || { text: submission.text || '' },
      audience: frame.audience,
      parent_id: frame.parent_id || '',
      visibility: frame.visibility || 'public',
      ts: submission.createdAt || Date.now(),
      sender: { id: selfId, kind: 'human' },
      local_submission_state: submission.state,
    };
    return [{
      requestId: request.id,
      request,
      requestSeq: 0,
      lastSeq: 0,
      provisional: [],
      terminal: null,
      status: 'local',
      local: true,
      waitingPresentation: submission.state === 'queued'
        ? 'stored-local'
        : submission.state === 'transmitting'
          ? 'transmitting'
          : 'confirming',
    }];
  }));
}
