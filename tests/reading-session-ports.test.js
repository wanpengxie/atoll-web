import { describe, expect, it } from 'vitest';
import { HISTORY_INTENT } from '../src/model/history-demand.js';
import {
  blockingAdmission,
  historyConsumerObligation,
  historyRevealIntent,
} from '../src/ui/timeline/history-consumer-obligation.js';
import {
  emptyDOMEvidence,
  observedDOMEvidence,
  transferDOMEvidence,
} from '../src/ui/timeline/dom-evidence-adapter.js';
import {
  createNotificationConfirmation,
  nextNotificationConfirmation,
  queuePresentedConfirmation,
  reconcileNotificationConfirmation,
  settleNotificationConfirmation,
} from '../src/ui/timeline/notification-confirmation-port.js';

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

  it('adapts DOM observations and transfers them only across an exact owner tuple', () => {
    const controller = { activationID: 'a' };
    const owner = {
      controller, activationID: 'a', channelID: 'c', viewKey: 'v',
      session: { inputEpoch: 1 }, snapshot: { revision: 2, sourceRevision: 3 },
      historyStatus: { generation: 4 },
    };
    const evidence = observedDOMEvidence({
      owner, controller, activationID: 'a', observationRevision: 5,
      observation: { atTail: true, surfaceVisible: true, installedHighSeq: 8, visibleRows: [{ messageID: 'm8' }] },
      snapshot: owner.snapshot,
      historyStatus: { generation: 4, headSeq: 9, notificationAuthorityRevision: 6 },
    });
    const successor = { ...owner };
    expect(transferDOMEvidence(evidence, owner, successor, { controller, surfaceVisible: true })).toMatchObject({
      owner: successor, atTail: true, observationRevision: 5,
    });
    expect(transferDOMEvidence(evidence, owner, { ...owner, controller: {} }, {
      controller, surfaceVisible: true, notificationAuthorityRevision: 7, observationRevision: 6,
    })).toMatchObject({ atTail: false, visibleRows: [] });
    expect(emptyDOMEvidence({ owner, controller, activationID: 'a' }).readPending).toBe(false);
  });

  it('plans notification receipts without delivering or persisting them', () => {
    let state = createNotificationConfirmation(3, 2, 4);
    const evidence = {
      notificationAuthorityRevision: 3, generation: 2, observationRevision: 5,
      headSeq: 10, installedHighSeq: 9, sourceRevision: 8, presentationRevision: 7,
    };
    const context = {
      channelID: 'c', viewKey: 'v', activationID: 'a', evidence,
      attached: true, messageCurrent: true, presentationRevision: 8,
    };
    state = queuePresentedConfirmation(state, context, 8);
    let planned = nextNotificationConfirmation(state, context);
    expect(planned.event).toMatchObject({ cause: 'tail-backlog', boundary: 10 });
    state = settleNotificationConfirmation(planned.state, planned.event, true);
    const advanced = {
      ...context,
      evidence: { ...evidence, headSeq: 12, installedHighSeq: 11 },
    };
    state = queuePresentedConfirmation(state, advanced, 11);
    planned = nextNotificationConfirmation(state, advanced);
    expect(planned.event).toMatchObject({ cause: 'presented-follow', boundary: 11 });
    state = settleNotificationConfirmation(planned.state, planned.event, false);
    expect(state.pending).toBe(planned.event);
    expect(reconcileNotificationConfirmation(state, {
      authorityRevision: 4, generation: 3, observationRevision: 6,
      controllerChanged: true, previousMode: 'following', currentMode: 'browsing', activationID: 'b',
    })).toMatchObject({ authorityRevision: 4, generation: 3, pending: null, needsBacklog: true });
  });
});
