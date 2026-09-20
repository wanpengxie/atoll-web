// @vitest-environment jsdom
// Round 35 strict Governance owner contracts. These are ordinary red tests on
// purpose: they preserve the fae8b70 user result until the current public
// owner supplies the missing causal projection/navigation boundaries.
import React, { useState } from 'react';
import {
  cleanup, fireEvent, render, screen, waitFor,
} from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ChannelCreateModal } from '../src/ui/features/governance/GovernanceFeature.jsx';
import { WorkspaceRightPanel } from '../src/ui/features/WorkspaceFeatures.jsx';

afterEach(() => {
  cleanup();
  globalThis.location.hash = '';
});

function createRequestPort({ children = [], submit = vi.fn().mockResolvedValue('create-request'), navigation } = {}) {
  return {
    children,
    ...(navigation ? { navigation } : {}),
    commands: { submit },
  };
}

describe('Round 35 Governance public-owner contracts', () => {
  it('does not let a same-name child from before this request satisfy convergence', async () => {
    const submit = vi.fn().mockResolvedValue('create-request-35');
    render(<ChannelCreateModal
      channel={{ id: 'c0', qualified_name: 'c0' }}
      port={createRequestPort({
        submit,
        children: [{
          id: 'c0.research',
          name: 'research',
          qualified_name: 'c0.research',
          parent_id: 'c0',
          open: true,
          access: 'member_active',
          // Explicitly an older directory fact; name/id equality is not
          // causal evidence for the request that was just submitted.
          observedAt: 100,
        }],
      })}
      onClose={vi.fn()}
    />);

    fireEvent.change(screen.getByLabelText('新频道名称'), { target: { value: 'research' } });
    fireEvent.click(screen.getByRole('button', { name: '创建频道' }));
    await waitFor(() => expect(submit).toHaveBeenCalledWith(expect.objectContaining({
      scope: 'channel', action: 'create_child',
      payload: expect.objectContaining({ name: 'research', parentId: 'c0' }),
    })));

    // The old row must not turn the just-accepted request into a false
    // ready/enter state. A real new row needs a post-request causal identity.
    expect(screen.queryByRole('button', { name: '进入新频道' })).toBeNull();
    expect(screen.getByRole('region', { name: '频道创建进度' }).textContent).toContain('正在收敛');
  });

  it('routes a ready child through the Shell navigation port without mutating location.hash', async () => {
    const submit = vi.fn().mockResolvedValue('create-request-35-shell');
    const enterChannel = vi.fn().mockResolvedValue(true);

    function Harness() {
      const [children, setChildren] = useState([]);
      const [creation, setCreation] = useState(null);
      const commands = {
        submit: async (command) => {
          const result = await submit(command);
          const channel = {
            id: 'c0.research',
            name: 'research',
            qualified_name: 'c0.research',
            parent_id: 'c0',
            open: true,
            accessState: { relationship: 'member' },
          };
          setChildren([channel]);
          setCreation({
            requestId: result,
            accepted: true,
            ledger: true,
            observable: true,
            membership: true,
            serving: true,
            channel,
          });
          return result;
        },
        // This callback is the explicit Shell navigation port. The feature
        // must not manufacture a route by assigning location.hash itself.
        enterChannel,
      };
      return <WorkspaceRightPanel
        panel={{ kind: 'channel-administration', initialTab: 'overview' }}
        channel={{ id: 'c0', qualified_name: 'c0' }}
        governance={{ channel: { children, creation, commands } }}
        onClose={vi.fn()}
      />;
    }

    globalThis.location.hash = '#/channels/c0/conversation';
    render(<Harness />);
    fireEvent.change(screen.getByLabelText('新频道名称'), { target: { value: 'research' } });
    fireEvent.click(screen.getByRole('button', { name: '创建频道' }));
    await waitFor(() => {
      const enter = screen.getByRole('button', { name: '进入新频道' });
      expect(enter.disabled).toBe(false);
    });

    fireEvent.click(screen.getByRole('button', { name: '进入新频道' }));
    expect(enterChannel).toHaveBeenCalledWith({ channelId: 'c0.research', view: 'conversation' });
    expect(globalThis.location.hash).toBe('#/channels/c0/conversation');
  });

  it('[AD-154] keeps a failed ledger terminal observable and leaves the request retryable', async () => {
    const submit = vi.fn().mockResolvedValue('create-request-37-failed');

    function Harness() {
      const [creation, setCreation] = useState(null);
      const commands = {
        submit: async (command) => {
          const result = await submit(command);
          setCreation({
            requestId: result,
            accepted: true,
            ledger: false,
            observable: false,
            membership: false,
            serving: false,
            failed: true,
            error: '名称已存在',
          });
          return result;
        },
      };
      return <WorkspaceRightPanel
        panel={{ kind: 'channel-administration', initialTab: 'overview' }}
        channel={{ id: 'c0', qualified_name: 'c0' }}
        governance={{ channel: { children: [], creation, commands } }}
        onClose={vi.fn()}
      />;
    }

    render(<Harness />);
    const name = screen.getByLabelText('新频道名称');
    fireEvent.change(name, { target: { value: 'research' } });
    fireEvent.click(screen.getByRole('button', { name: '创建频道' }));
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('名称已存在'));

    const progress = screen.getByRole('region', { name: '频道创建进度' });
    expect(progress.textContent).toContain('创建失败');
    expect(screen.getByRole('button', { name: '重新创建' }).disabled).toBe(false);
    expect(name.disabled).toBe(false);
    expect(screen.queryByRole('button', { name: '进入新频道' })).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: '重新创建' }));
    await waitFor(() => expect(screen.getByRole('button', { name: '创建频道' })).toBeTruthy());
    expect(screen.getByLabelText('新频道名称').value).toBe('research');
    fireEvent.click(screen.getByRole('button', { name: '创建频道' }));
    await waitFor(() => expect(submit).toHaveBeenCalledTimes(2));
    expect(submit).toHaveBeenNthCalledWith(2, expect.objectContaining({
      scope: 'channel', action: 'create_child',
      payload: expect.objectContaining({ name: 'research', parentId: 'c0' }),
    }));
    expect(screen.getByLabelText('新频道名称').value).toBe('research');
  });
});
