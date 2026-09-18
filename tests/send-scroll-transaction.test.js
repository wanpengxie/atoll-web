import { describe, expect, it } from 'vitest';
import {
  advanceSendScrollTransaction,
  createSendScrollTransaction,
  sendScrollTransactionCanWrite,
} from '../src/model/send-scroll-transaction.js';

const intent = {
  id: 'composer:send-start:one', inputEpoch: 4,
  afterPresentationRevision: 10, targetMessageIDs: ['request-1'],
};
const context = { activationID: 'activation:a', inputEpoch: 4 };

function event(type, detail = {}) { return { type, ...context, ...detail }; }

describe('send scroll transaction', () => {
  for (const order of [['ready', 'measured'], ['measured', 'ready']]) {
    it(`joins ${order.join(' before ')} into send-ready authority`, () => {
      let state = createSendScrollTransaction(intent, context.activationID);
      for (const type of order) {
        state = advanceSendScrollTransaction(state, event(type, type === 'ready'
          ? { revision: 11, targetIDs: ['request-1'], destination: 'timeline' }
          : { revision: 11, height: 900, targetIDs: ['request-1'] }));
      }
      expect(sendScrollTransactionCanWrite(state)).toBe(true);
    });
  }

  it('accepts a committed queued destination as the send intent write', () => {
    let state = createSendScrollTransaction(intent, context.activationID);
    state = advanceSendScrollTransaction(state, event('measured', {
      revision: 11, height: 900, targetIDs: ['request-1'],
    }));
    state = advanceSendScrollTransaction(state, event('ready', {
      revision: 11, targetIDs: ['request-1'], destination: 'waiting',
    }));
    expect(sendScrollTransactionCanWrite(state)).toBe(true);
  });

  it('joins every target destination in a mixed batch before the send write', () => {
    const batchIntent = { ...intent, targetMessageIDs: ['human-1', 'agent-1'] };
    let state = createSendScrollTransaction(batchIntent, context.activationID);
    state = advanceSendScrollTransaction(state, event('measured', {
      revision: 11, height: 900, targetIDs: ['human-1', 'agent-1'],
    }));
    state = advanceSendScrollTransaction(state, event('ready', {
      revision: 11,
      targetIDs: batchIntent.targetMessageIDs,
      destinations: [
        { messageID: 'human-1', destination: 'timeline' },
        { messageID: 'agent-1', destination: 'waiting' },
      ],
    }));
    expect(state.destination).toBe('mixed');
    expect(sendScrollTransactionCanWrite(state)).toBe(true);
  });

  it('does not suppress later same-id stream for a timeline destination', () => {
    let state = createSendScrollTransaction(intent, context.activationID);
    state = advanceSendScrollTransaction(state, event('ready', {
      revision: 11, targetIDs: ['request-1'], destination: 'timeline',
    }));
    state = advanceSendScrollTransaction(state, event('measured', {
      revision: 11, height: 900, targetIDs: ['request-1'],
    }));
    expect(sendScrollTransactionCanWrite(state)).toBe(true);
  });

  it('ignores a stale destination acknowledgement after a newer ready revision', () => {
    let state = createSendScrollTransaction(intent, context.activationID);
    state = advanceSendScrollTransaction(state, event('ready', {
      revision: 12, targetIDs: ['request-1'], destination: 'timeline',
    }));
    const newer = state;
    state = advanceSendScrollTransaction(state, event('ready', {
      revision: 11, targetIDs: ['request-1'], destination: 'waiting',
    }));
    expect(state).toBe(newer);
    expect(state.destination).toBe('timeline');
  });

  it('joins an earlier target-row measurement with later metadata-only timeline readiness', () => {
    let state = createSendScrollTransaction(intent, context.activationID);
    state = advanceSendScrollTransaction(state, event('measured', {
      revision: 11, height: 900, targetIDs: ['request-1'],
    }));
    state = advanceSendScrollTransaction(state, event('ready', {
      revision: 14,
      targetIDs: ['request-1'],
      destinations: [{
        messageID: 'request-1', destination: 'timeline', targetListRevision: 11,
      }],
    }));
    expect(sendScrollTransactionCanWrite(state)).toBe(true);
  });

  it('does not mistake an unrelated post-baseline layout measurement for target geometry', () => {
    let state = createSendScrollTransaction(intent, context.activationID);
    state = advanceSendScrollTransaction(state, event('measured', {
      revision: 11, height: 900, targetIDs: ['other-row'],
    }));
    state = advanceSendScrollTransaction(state, event('ready', {
      revision: 14, targetIDs: ['request-1'], destination: 'timeline',
    }));
    expect(sendScrollTransactionCanWrite(state)).toBe(false);
  });

  it('uses the latest same-revision public target measurement when measured height decreases', () => {
    let state = createSendScrollTransaction(intent, context.activationID);
    state = advanceSendScrollTransaction(state, event('measured', {
      revision: 11, height: 1200, targetIDs: ['request-1'],
    }));
    state = advanceSendScrollTransaction(state, event('measured', {
      revision: 11, height: 1100, targetIDs: ['request-1'],
    }));
    state = advanceSendScrollTransaction(state, event('ready', {
      revision: 11, targetIDs: ['request-1'], destination: 'timeline',
    }));
    expect(state.measuredHeight).toBe(1100);
    expect(sendScrollTransactionCanWrite(state)).toBe(true);
  });

  it('allows a committed waiting destination while the list stays at the baseline revision', () => {
    let state = createSendScrollTransaction(intent, context.activationID);
    state = advanceSendScrollTransaction(state, event('ready', {
      revision: 10, targetIDs: ['request-1'], destination: 'waiting',
    }));
    expect(sendScrollTransactionCanWrite(state)).toBe(true);
  });

  it('invalidates before write on user takeover or activation replacement', () => {
    const state = createSendScrollTransaction(intent, context.activationID);
    expect(advanceSendScrollTransaction(state, event('invalidate'))).toBeNull();
    expect(advanceSendScrollTransaction(state, event('ready', {
      activationID: 'activation:b', revision: 11, targetIDs: ['request-1'], destination: 'timeline',
    }))).toBeNull();
    expect(advanceSendScrollTransaction(state, event('measured', {
      inputEpoch: 5, revision: 11,
    }))).toBeNull();
  });
});
