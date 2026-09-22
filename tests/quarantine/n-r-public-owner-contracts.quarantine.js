import { describe, expect, it } from 'vitest';
import {
  isRailNotifiableDisposition,
  isViewportNotifiableDisposition,
  notificationDisposition,
  readerCaughtUp,
  viewportUnseenNotice,
} from '../src/model/notification-policy.js';
import {
  createChannelReplicaStore,
  mergeReplicaCoverage,
} from '../src/model/channel-replica.js';
import {
  READING_MODE,
  createReadingSession,
  observeReading,
  requestLatest,
  takeReadingControl,
} from '../src/model/reading-session.js';
import { isVisibleActor } from '../src/model/actor-visibility.js';
import {
  buildComposerModel,
  composerPermissions,
  createMessageRequest,
} from '../src/ui/composer/composer-model.js';

const AGENT = { id: 'agent:demo:1', kind: 'agent', name: 'Demo' };
const SELF = { id: 'human:root:1', kind: 'human', name: 'Root' };

describe('N–R current public owners', () => {
  it('keeps notification visibility and rail classification on the shared policy', () => {
    const present = {
      following: true,
      atTail: true,
      surfaceVisible: true,
      documentVisible: true,
    };
    expect(readerCaughtUp(present)).toBe(true);
    expect(viewportUnseenNotice(4, true)).toBe(0);
    expect(viewportUnseenNotice(4, false)).toBe(4);

    const event = {
      id: 'event-1',
      kind: 'event',
      type: 'human.note',
      sender: AGENT,
      audience: [SELF.id],
      payload: { body: { text: 'readable event' } },
    };
    const disposition = notificationDisposition({ timeline: [] }, event, SELF.id);
    expect(disposition).toBe('event');
    expect(isViewportNotifiableDisposition(disposition)).toBe(true);
    expect(isRailNotifiableDisposition(disposition)).toBe(false);
  });

  it('rebuilds out-of-order rows through the sole Replica owner', () => {
    const replica = createChannelReplicaStore();
    replica.commit({
      channel_id: 'c0',
      seq: 2,
      envelope: {
        id: 'done',
        parent_id: 'request',
        kind: 'response',
        type: 'agent.ask',
        sender: AGENT,
        audience: [SELF.id],
        payload: { body: { status: 'completed', text: 'done' } },
      },
    });
    replica.commit({
      channel_id: 'c0',
      seq: 1,
      envelope: {
        id: 'request',
        kind: 'request',
        type: 'agent.ask',
        sender: SELF,
        audience: [AGENT.id],
        payload: { body: { text: 'work' } },
      },
    });

    const turn = replica.state('c0').timeline.find((entry) => entry.turn?.requestId === 'request')?.turn;
    expect(turn).toMatchObject({ requestId: 'request', status: 'completed' });
    expect(turn.terminal.id).toBe('done');
    expect(mergeReplicaCoverage([{ lowSeq: 1, highSeq: 2 }], { lowSeq: 3, highSeq: 3 }))
      .toEqual([{ lowSeq: 1, highSeq: 3 }]);
  });

  it('lets the Reading owner take, invalidate, and re-establish following authority', () => {
    let session = createReadingSession({ key: 'c0:conversation', activationID: 'activation-1' });
    session = takeReadingControl(session, {
      direction: 'newer',
      gestureID: 'gesture-1',
      geometryRevision: 7,
    });
    expect(session.mode).toBe(READING_MODE.browsing);

    const layoutAtTail = observeReading(session, {
      activationID: 'activation-1',
      inputEpoch: session.inputEpoch,
      geometryRevision: 7,
      atTail: true,
      source: 'layout',
    });
    expect(layoutAtTail.mode).toBe(READING_MODE.browsing);

    session = observeReading(session, {
      activationID: 'activation-1',
      inputEpoch: session.inputEpoch,
      geometryRevision: 7,
      atTail: true,
      source: 'user',
    });
    expect(session.mode).toBe(READING_MODE.following);

    const latest = requestLatest(session, 'latest-1', {
      afterPresentationRevision: 4,
      baselineTailID: 'tail-1',
      targetMessageIDs: ['m-1'],
    });
    expect(latest.mode).toBe(READING_MODE.following);
    expect(latest.bottomIntent).toMatchObject({
      id: 'latest-1',
      afterPresentationRevision: 4,
      baselineTailID: 'tail-1',
      targetMessageIDs: ['m-1'],
    });
  });

  it('routes replies through Composer delivery and keeps the parent id in the request', () => {
    const model = buildComposerModel({
      activeChannelId: 'c0',
      access: 'member_active',
      selfId: SELF.id,
      roster: [SELF, AGENT],
      draft: {
        text: 'follow up',
        replyTarget: { senderId: AGENT.id, senderName: AGENT.name, sourceId: 'parent-1' },
      },
    });
    expect(model.delivery).toMatchObject({ kind: 'direct', source: 'reply' });
    expect(model.canSubmit).toBe(true);
    expect(createMessageRequest(model, { revision: 3 }).batch[0]).toMatchObject({
      audience: [AGENT.id],
      parentId: 'parent-1',
      text: 'follow up',
    });

    const lost = buildComposerModel({
      activeChannelId: 'c0',
      access: 'member_active',
      selfId: SELF.id,
      roster: [SELF],
      draft: { text: 'cannot deliver', replyTarget: { senderId: AGENT.id } },
    });
    expect(lost.delivery.kind).toBe('lost');
    expect(lost.canSubmit).toBe(false);
  });

  it('keeps access and roster visibility decisions on public projections', () => {
    expect(composerPermissions('member_active')).toEqual({
      canEditDraft: true,
      canDurablyAccept: true,
      canTransmit: true,
      reason: '',
    });
    expect(composerPermissions('observer_active').canDurablyAccept).toBe(false);
    expect(isVisibleActor({ id: 'system', kind: 'system' })).toBe(false);
    expect(isVisibleActor({ id: 'human:root:1', kind: 'human' })).toBe(true);
    expect(isVisibleActor({ id: 'agent:demo:1', kind: 'agent', decl_id: 'demo:agent' })).toBe(true);
  });
});
