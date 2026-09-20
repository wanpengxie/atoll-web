// @vitest-environment jsdom
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { WorkspaceFeatureOverlays } from '../src/ui/features/WorkspaceFeatures.jsx';

afterEach(cleanup);

describe('Workspace Files → Composer picker port', () => {
  it('uses the Files projection and returns the selected resource without a second store', async () => {
    const user = userEvent.setup();
    const onChoose = vi.fn();
    const onClose = vi.fn();
    const entry = {
      key: 'resource:c0:readme',
      kind: 'file',
      name: 'README.md',
      resourceId: 'daemon://local-device/c0/README.md',
      mediaType: 'text/markdown',
      size: 12,
    };
    render(<WorkspaceFeatureOverlays filePicker={{
      open: true,
      channel: { id: 'c0', qualified_name: 'c0' },
      files: {
        deviceId: 'local-device',
        devices: [{ id: 'local-device', name: 'local-device' }],
        entries: [entry],
        commands: {},
      },
      onChoose,
      onClose,
    }} />);

    expect(screen.getByRole('dialog', { name: '从频道文件选择' })).toBeTruthy();
    await user.click(screen.getByRole('button', { name: /README\.md/ }));
    expect(onChoose).toHaveBeenCalledWith(entry);
    await user.click(screen.getByRole('button', { name: '关闭频道文件选择' }));
    expect(onClose).toHaveBeenCalled();
  });
});
