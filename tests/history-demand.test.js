import { describe, expect, it } from 'vitest';
import {
  HISTORY_INTENT,
  HISTORY_URGENCY,
} from '../src/model/history-demand.js';
import {
  blockingAdmission,
  historyConsumerObligation,
  historyRevealIntent,
  ownsHistoryOperation,
} from '../src/ui/timeline/history-consumer-obligation.js';

// Successor coverage for the deleted createHistoryDemandPort/read-cursor
// surface.  History acquisition is now owned by useHistoryConsumer and its
// typed obligation/admission helpers; this test keeps the semantic UX boundary
// without restoring the retired scheduler/ack compatibility API.
describe('current history demand boundary', () => {
  it('keeps intent and urgency as semantic vocabulary, not scheduler knobs', () => {
    expect(HISTORY_INTENT).toEqual({
      initialView: 'initial-view',
      scrollHistory: 'scroll-history',
      searchContext: 'search-context',
    });
    expect(HISTORY_URGENCY).toEqual({
      blocking: 'blocking',
      interactive: 'interactive',
      anticipatory: 'anticipatory',
    });
    expect(HISTORY_INTENT).not.toHaveProperty('pageSize');
    expect(HISTORY_URGENCY).not.toHaveProperty('priority');
  });

  it('fences an obligation by source lease, supply progress, and presentation progress', () => {
    const status = {
      generation: 4,
      attached: true,
      localReplicaReady: true,
      sourceLease: 'lease-a',
      oldestSeq: 80,
      completedPages: 2,
      revealVersion: 3,
      buffered: 5,
      hasOlder: true,
      presentationRevision: 9,
      historyDemand: { revision: 7 },
    };
    const obligation = historyConsumerObligation({
      intent: HISTORY_INTENT.initialView,
      targetSeq: 42,
      requiredVisibleCoverage: { messageID: 'row-42', seq: 42 },
      firstRow: { id: 'row-80', seqLow: 80 },
      status,
    });
    expect(obligation.key).toContain('row-42');
    expect(obligation.sourceKey).toContain('lease-a');
    expect(obligation.supplyKey).toContain('80');
    expect(obligation.progressKey).toContain('9');
    expect(Object.isFrozen(obligation)).toBe(true);
  });

  it('creates a bounded reveal intent only for scroll history', () => {
    const base = {
      activationID: 'activation-1',
      inputEpoch: 2,
      intentRevision: 5,
      epoch: 7,
      viewKey: 'c0:all',
      channelID: 'c0',
      status: { generation: 4 },
      snapshot: { revision: 3, rows: [{ id: 'row-80', seqLow: 80, localState: false }] },
    };
    expect(historyRevealIntent({ ...base, intent: HISTORY_INTENT.searchContext, demandUnits: 99 })).toBeNull();
    expect(historyRevealIntent({
      ...base,
      intent: HISTORY_INTENT.scrollHistory,
      demandUnits: 99,
      historyAnchor: { messageID: 'row-80', viewportOffset: -394 },
    })).toMatchObject({
      operationID: 'history:activation-1:7',
      epoch: 'c0:4', intentRevision: 5,
      anchorID: 'row-80',
      anchorSeq: 80,
      messageID: 'row-80', viewportOffset: -394,
      demandUnits: 24,
      durableBaselineIDs: ['row-80'],
    });
  });

  it('accepts a blocking admission only for the current activation/view/generation tuple', () => {
    const state = {
      phase: 'committed-awaiting-layout',
      token: { activationID: 'a', viewID: 'c0:all', epoch: 'c0:4', operationID: 'history:a:7' },
    };
    const status = { generation: 4, presentationAdmissionState: state };
    expect(blockingAdmission(status, { channelID: 'c0', activationID: 'a', viewKey: 'c0:all' })).toBe(state);
    expect(blockingAdmission(status, { channelID: 'c0', activationID: 'old', viewKey: 'c0:all' })).toBeNull();
    expect(blockingAdmission(status, { channelID: 'c0', activationID: 'a', viewKey: 'c0:mine' })).toBeNull();
    expect(blockingAdmission({ ...status, generation: 5 }, { channelID: 'c0', activationID: 'a', viewKey: 'c0:all' })).toBeNull();
  });

  it('settles only the exact current physical operation owner', () => {
    const controller = {};
    const promise = Promise.resolve();
    const owner = {
      controller,
      activationID: 'a',
      channelID: 'c0',
      viewKey: 'c0:all',
      historyStatus: { generation: 4 },
    };
    expect(ownsHistoryOperation(owner, owner, controller, promise, promise)).toBe(true);
    expect(ownsHistoryOperation(owner, { ...owner, viewKey: 'c0:mine' }, controller, promise, promise)).toBe(false);
    expect(ownsHistoryOperation(owner, owner, {}, promise, promise)).toBe(false);
    expect(ownsHistoryOperation(owner, owner, controller, promise, Promise.resolve())).toBe(false);
  });
});
