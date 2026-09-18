// @vitest-environment jsdom
import React from 'react';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FilesPanel } from '../src/ui/resources/FilesPanel.jsx';

afterEach(cleanup);

describe('advanced files lifecycle', () => {
  it('keeps ticket, PUT and readable confirmation inside one owned operation', async () => {
    const user = userEvent.setup();
    const resource = vi.fn(async (payload) => (payload.op === 'create'
      ? { ticket: 'put-ticket', resource_id: 'resource-1' }
      : { ticket: 'read-ticket' }));
    const transfer = vi.fn(async () => ({ ok: true }));
    const onFileOperation = vi.fn(async (_identity, effect) => effect({ resource, fetch: transfer }));
    render(<FilesPanel
      channel={{ id: 'c0', qualified_name: 'c0', default_storage_device_id: 'device-1' }}
      devices={[{ id: 'device-1', name: 'storage' }]}
      onResource={resource}
      onFileOperation={onFileOperation}
      onAttach={vi.fn()}
    />);
    await user.upload(screen.getByLabelText('选择上传文件'), new File(['body'], 'owned.txt', { type: 'text/plain' }));
    await user.click(screen.getByRole('button', { name: '上传' }));
    await screen.findByText('上传完成');
    expect(onFileOperation).toHaveBeenCalledOnce();
    expect(onFileOperation.mock.calls[0][0]).toEqual({ channelId: 'c0', access: 'write' });
    expect(resource).toHaveBeenCalledTimes(2);
    expect(transfer).toHaveBeenCalledOnce();
    expect(await screen.findByText('resource-1')).toBeTruthy();
  });

  it('does not call attach while edit/access policy disables the action', async () => {
    const user = userEvent.setup();
    const onAttach = vi.fn();
    const resource = vi.fn(async (payload) => (payload.op === 'create'
      ? { ticket: 'put-ticket', resource_id: 'resource-1' }
      : { ticket: 'read-ticket' }));
    const onFileOperation = vi.fn(async (_identity, effect) => effect({ resource, fetch: async () => ({ ok: true }) }));
    render(<FilesPanel
      channel={{ id: 'c0', qualified_name: 'c0', default_storage_device_id: 'device-1' }}
      devices={[{ id: 'device-1', name: 'storage' }]}
      attachDisabled
      attachDisabledReason="编辑事务占用"
      onResource={resource}
      onFileOperation={onFileOperation}
      onAttach={onAttach}
    />);
    await user.upload(screen.getByLabelText('选择上传文件'), new File(['body'], 'owned.txt', { type: 'text/plain' }));
    await user.click(screen.getByRole('button', { name: '上传' }));
    const attach = await screen.findByRole('button', { name: '附加到消息' });
    await waitFor(() => expect(attach.disabled).toBe(true));
    await user.click(attach);
    expect(onAttach).not.toHaveBeenCalled();
  });
});
