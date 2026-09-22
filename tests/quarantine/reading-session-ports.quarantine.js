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
import { topVisibleBookmark } from '../src/ui/timeline/reading-geometry.js';

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
    expect(historyRevealIntent({
      intent: HISTORY_INTENT.scrollHistory,
      activationID: 'a',
      inputEpoch: 3,
      intentRevision: 5,
      epoch: 8,
      viewKey: 'v',
      channelID: 'c',
      status,
      snapshot: { revision: 4, rows: [{ id: 'm12', seqLow: 12 }] },
      demandUnits: 1,
      historyStart: true,
    })).toMatchObject({ historyStart: true, messageID: '', viewportOffset: null, anchorSeq: 0 });
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

  it('does not promote a virtualizer top sliver to the reading bookmark', () => {
    const rows = [{ id: 'm111', seqLow: 111 }, { id: 'm112', seqLow: 112 }];
    const nodes = [
      { dataset: { presentationRowId: 'm111' }, getBoundingClientRect: () => ({
        left: 0, right: 100, top: -8, bottom: 1.5,
      }), contains: () => false },
      { dataset: { presentationRowId: 'm112' }, getBoundingClientRect: () => ({
        left: 0, right: 100, top: 1.5, bottom: 220,
      }), contains: () => false },
    ];
    const root = {
      getBoundingClientRect: () => ({ left: 0, right: 100, top: 0, bottom: 500 }),
      querySelectorAll: () => nodes,
    };

    expect(topVisibleBookmark(root, rows)).toMatchObject({
      messageID: 'm112', rowViewportOffset: 1.5,
    });
  });

  it('restores a committed content anchor only after the measured extent changes', () => {
    const scrollTo = vi.fn();
    let scrollHeight = 1000;
    const root = {
      scrollTop: 200,
      clientHeight: 400,
      get scrollHeight() { return scrollHeight; },
      getBoundingClientRect: () => ({ top: 100 }),
      querySelectorAll: () => [{
        getAttribute: (name) => ({
          'data-fold-id': 'turn:body',
          'aria-expanded': 'true',
        }[name] || null),
        getBoundingClientRect: () => ({ top: 300 }),
      }],
      scrollTo,
    };
    const command = {
      type: 'restore-content-anchor',
      activationID: 'a1', inputEpoch: 2, anchorID: 'turn:body',
      viewportOffset: 250, beforeScrollHeight: 1000, expectedExpanded: true,
    };

    expect(executeReadingDOMCommand(command, { root })).toBe(false);
    expect(scrollTo).not.toHaveBeenCalled();

    scrollHeight = 900;
    expect(executeReadingDOMCommand(command, { root })).toBe(true);
    expect(scrollTo).toHaveBeenCalledWith({ top: 150, behavior: 'auto' });
  });
});
