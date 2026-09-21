// @vitest-environment jsdom
import React from 'react';
import userEvent from '@testing-library/user-event';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Composer } from '../src/ui/composer/Composer.jsx';
import { buildComposerModel } from '../src/ui/composer/composer-model.js';

afterEach(cleanup);

function attachmentModel(attachment) {
  return buildComposerModel({
    activeChannelId: 'c0',
    draft: { text: '', recipients: [], attachments: [attachment] },
    roster: [{ id: 'agent:researcher:1', kind: 'agent', name: '研究员' }],
    agentSelection: { selectedAgentId: 'agent:researcher:1' },
    access: 'member_active',
  });
}

describe('TC-0652 Composer draft attachment actions', () => {
  it('opens preview from the attachment body and keeps delete as a separate action', async () => {
    const user = userEvent.setup();
    const attachment = {
      resource_id: 'file:draft',
      name: '草稿报告.pdf',
      media_type: 'application/pdf',
      size: 4096,
    };
    const previewAttachment = vi.fn();
    const removeAttachment = vi.fn();

    render(<Composer
      model={attachmentModel(attachment)}
      commands={{ previewAttachment, removeAttachment }}
    />);

    await user.click(screen.getByRole('button', { name: '预览文件 草稿报告.pdf' }));
    expect(previewAttachment).toHaveBeenCalledWith(attachment);
    expect(removeAttachment).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: '移除附件 草稿报告.pdf' }));
    expect(removeAttachment).toHaveBeenCalledWith('file:draft');
    expect(previewAttachment).toHaveBeenCalledTimes(1);
  });
});
