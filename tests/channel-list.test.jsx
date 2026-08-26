// @vitest-environment jsdom
import React from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ChannelList } from '../src/ui/ChannelList.jsx';

afterEach(cleanup);

const props = {
  channels: [{ id: 'c0', name: 'c0', access: 'member_active' }],
  activeChannelId: '',
  wireState: 'open',
  me: { id: 'root', display_name: 'Root' },
  onSelect: vi.fn(), onCreate: vi.fn(), onSearch: vi.fn(), onActivity: vi.fn(), onSpaceManage: vi.fn(), onLogout: vi.fn(),
};

describe('channel notification badges', () => {
  it('shows related roots strongly and only the additional unrelated roots weakly', () => {
    render(<ChannelList {...props} unread={{ c0: { related: 2, total: 5 } }} />);
    expect(screen.getByLabelText('2 条与我相关的未读消息').textContent).toBe('2');
    expect(screen.getByLabelText('3 条其他未读消息').textContent).toBe('3');
    expect(screen.queryByLabelText('5 条全部未读消息')).toBeNull();
  });

  it('does not repeat the same count when every unread root is related', () => {
    render(<ChannelList {...props} unread={{ c0: { related: 2, total: 2 } }} />);
    expect(screen.getByLabelText('2 条与我相关的未读消息')).toBeTruthy();
    expect(screen.queryByTitle('其他未读消息')).toBeNull();
  });
});
