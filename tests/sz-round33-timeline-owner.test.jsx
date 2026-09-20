// @vitest-environment jsdom
//
// Round-33 owner evidence for the surviving TimelineRowRenderer surface.
// This deliberately tests the current public row renderer, not the deleted
// system-event decoder/presentation modules.  The typed event validation and
// standard-actor policy remain separate product packets in the audit report.
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

describe('S-Z round 33 current timeline owner', () => {
  it('renders a known narration word through the public row owner without exposing its wire type', () => {
    render(<NarrationHarness
      names={new Map([['system', '系统']])}
      envelope={{
        id: 'member-created',
        kind: 'event',
        type: TYPES.narration.memberCreated,
        visibility: 'system',
        sender: { id: 'system', kind: 'system' },
        payload: { body: { member: 'agent:worker:1', decl_id: 'mock:worker' } },
      }}
    />);

    expect(screen.getByText('成员已加入')).toBeTruthy();
    expect(screen.queryByText(TYPES.narration.memberCreated)).toBeNull();
  });
});
