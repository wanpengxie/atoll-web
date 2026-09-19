import { describe, expect, it, vi } from 'vitest';
import { HISTORY_INTENT } from '../src/model/history-demand.js';
import {
  admissionOperationID,
  blockingAdmission,
  historyConsumerObligation,
  historyRevealIntent,
  ownsHistoryOperation,
} from '../src/ui/timeline/history-consumer-obligation.js';
import { executeReadingDOMCommand } from '../src/ui/timeline/reading-dom-command-executor.js';

describe('ReadingSession pure ports', () => {
  it('names one exact history obligation without owning its lifecycle', () => {
    const status = { generation: 4, attached: true, localReplicaReady: true, sourceLease: 'lease-a' };
    const obligation = historyConsumerObligation({
      intent: HISTORY_INTENT.initialView,
      targetSeq: 9,
      requiredVisibleCoverage: { messageID: 'm9', seq: 9 },
      firstRow: { id: 'm12', seqLow: 12 },
      status,
    });
    expect(obligation).toMatchObject({
      key: expect.stringContaining('m9'),
      sourceKey: expect.stringContaining('lease-a'),
    });
    expect(blockingAdmission({ generation: 4, presentationAdmissionState: {
      phase: 'pending-baseline-commit',
      token: { activationID: 'a', viewID: 'v', epoch: 'c:4' },
    } }, { channelID: 'c', activationID: 'a', viewKey: 'v' })).toBeTruthy();
    expect(historyRevealIntent({
      intent: HISTORY_INTENT.scrollHistory,
      activationID: 'a',
      inputEpoch: 2,
      epoch: 7,
      viewKey: 'v',
      channelID: 'c',
      status,
      snapshot: { revision: 3, rows: [{ id: 'm12', seqLow: 12 }] },
      demandUnits: 2,
    })).toMatchObject({ operationID: 'history:a:7', inputEpoch: 2, demandUnits: 2 });
  });

  it('addresses and settles history only through the exact current owner tuple', () => {
    const controller = {};
    const promise = Promise.resolve();
    const requestOwner = {
      controller,
      activationID: 'a',
      channelID: 'c',
      viewKey: 'v',
      historyStatus: { generation: 4 },
    };
    const presentationAdmission = {
      snapshot: () => ({
        phase: 'pending',
        token: { activationID: 'a', viewID: 'v', epoch: 'c:4', operationID: 'history:a:7' },
      }),
    };

    expect(admissionOperationID({ generation: 4, presentationAdmission }, requestOwner))
      .toBe('history:a:7');
    expect(ownsHistoryOperation(requestOwner, requestOwner, controller, promise, promise)).toBe(true);
    expect(ownsHistoryOperation(
      { ...requestOwner, historyStatus: { generation: 5 } },
      requestOwner,
      controller,
      promise,
      promise,
    )).toBe(false);
  });

  it('executes only typed DOM commands through the sole list adapter capability', () => {
    const scrollToIndex = vi.fn();
    const scrollTo = vi.fn();
    const focus = vi.fn();
    const root = { scrollHeight: 900, scrollTo, focus };

    expect(executeReadingDOMCommand(
      { type: 'position-row', index: 14, viewportOffset: -20 },
      { virtuoso: { scrollToIndex }, root },
    )).toBe(true);
    expect(scrollToIndex).toHaveBeenCalledWith({ index: 14, align: 'start', offset: 20 });

    expect(executeReadingDOMCommand({ type: 'scroll-tail' }, { root })).toBe(true);
    expect(scrollTo).toHaveBeenCalledWith({ top: 900, behavior: 'auto' });

    expect(executeReadingDOMCommand({ type: 'claim-focus' }, { root })).toBe(true);
    expect(focus).toHaveBeenCalledWith({ preventScroll: true });
    expect(executeReadingDOMCommand({ type: 'unknown' }, { root })).toBe(false);
  });
});
