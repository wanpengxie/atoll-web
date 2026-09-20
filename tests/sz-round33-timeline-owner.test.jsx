// @vitest-environment jsdom
//
// Round-33 owner evidence for the surviving TimelineRowRenderer surface.
// This deliberately tests the current public row renderer, not the deleted
// system-event decoder/presentation modules. The renderer now owns the small
// typed narration decoder and its user-facing policy.
import React from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { TYPES } from '../src/protocol/vocab.js';
import { useTimelineRowRenderer } from '../src/ui/timeline/TimelineRowRenderer.jsx';

afterEach(cleanup);

function NarrationHarness({ envelope, names = new Map() }) {
  const { renderRow } = useTimelineRowRenderer({
    state: { channelId: 'c0', narration: [{ seq: 1, envelope }] },
    names,
    selfId: 'human:root:1',
    presentationEditing: null,
    browsingExpandedSlots: new Set(),
    effectiveFoldOverrides: new Map(),
    approvalStates: {},
  });
  return renderRow({ id: 'narration-row', contentRevision: '1', body: { kind: 'narration' } });
}

describe('S-Z current Timeline system-event owner', () => {
  it('decodes a canonical member fact into product language without exposing its wire type', () => {
    render(<NarrationHarness
      names={new Map([['steward', 'Steward']])}
      envelope={{
        id: 'member-created',
        kind: 'event',
        type: TYPES.narration.memberCreated,
        visibility: 'system',
        sender: { id: 'system', kind: 'system' },
        payload: { body: { member: 'steward', decl_id: 'mock:steward' } },
      }}
    />);

    expect(screen.getByText('Steward 已加入频道')).toBeTruthy();
    expect(screen.queryByText(TYPES.narration.memberCreated)).toBeNull();
  });

  it('rejects malformed typed facts and never uses arbitrary text as a title', () => {
    render(<NarrationHarness envelope={{
      id: 'member-invalid',
      kind: 'event',
      type: TYPES.narration.memberCreated,
      visibility: 'system',
      sender: { id: 'system', kind: 'system' },
      payload: { body: { actor_id: 'steward', text: '伪造标题' } },
    }} />);

    expect(screen.getByText('无法识别的频道活动')).toBeTruthy();
    expect(screen.queryByText('伪造标题')).toBeNull();
  });

  it('uses a safe diagnostic for an unknown system event instead of guessing JSON fields', () => {
    render(<NarrationHarness envelope={{
      id: 'unknown-system-event',
      kind: 'event',
      type: 'unknown.internal.event',
      visibility: 'system',
      sender: { id: 'system', kind: 'system' },
      payload: { body: { actor_id: 'steward', text: '伪造标题', severity: 'critical' } },
    }} />);

    expect(screen.getByText('后台状态已更新')).toBeTruthy();
    expect(screen.queryByText('伪造标题')).toBeNull();
  });

  it('maps a valid channel-inbound fact using only its documented fields', () => {
    render(<NarrationHarness envelope={{
      id: 'channel-inbound',
      kind: 'event',
      type: TYPES.narration.channelInbound,
      visibility: 'system',
      sender: { id: 'system', kind: 'system' },
      payload: { body: { from: 'c0.peer', type: 'agent.ask', local_request_id: 'req-1', text: '伪造标题' } },
    }} />);

    expect(screen.getByText('收到来自 c0.peer 的频道请求：agent.ask')).toBeTruthy();
    expect(screen.queryByText('伪造标题')).toBeNull();
  });

  it('maps a canonical member deletion and preserves its typed reason', () => {
    render(<NarrationHarness
      names={new Map([['steward', 'Steward']])}
      envelope={{
        id: 'member-deleted',
        kind: 'event',
        type: TYPES.narration.memberDeleted,
        visibility: 'system',
        sender: { id: 'system', kind: 'system' },
        payload: { body: { member: 'steward', decl_id: 'mock:steward', reason: 'retired' } },
      }}
    />);

    expect(screen.getByText('Steward 已离开频道（原因：retired）')).toBeTruthy();
  });

  it('hides a canonical standard actor member event', () => {
    const view = render(<NarrationHarness envelope={{
      id: 'svcactor-created',
      kind: 'event',
      type: TYPES.narration.memberCreated,
      visibility: 'system',
      sender: { id: 'system', kind: 'system' },
      payload: { body: { member: 'svcactor', decl_id: 'svcactor' } },
    }} />);

    expect(view.container.querySelector('.timeline-narration p')).toBeNull();
  });

  it('silently ignores a flat legacy payload instead of restoring compatibility parsing', () => {
    const view = render(<NarrationHarness envelope={{
      id: 'flat-member-created',
      kind: 'event',
      type: TYPES.narration.memberCreated,
      visibility: 'system',
      sender: { id: 'system', kind: 'system' },
      payload: { member: 'steward', text: 'flat legacy fact' },
    }} />);

    expect(view.container.querySelector('.timeline-narration p')).toBeNull();
    expect(view.container.textContent).not.toContain('flat legacy fact');
  });
});
