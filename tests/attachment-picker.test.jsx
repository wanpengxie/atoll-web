// @vitest-environment jsdom
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { uploadChannelFile } from '../src/model/channel-file-transfer.js';
import { ChannelFilePickerModal } from '../src/ui/ChannelFilePickerModal.jsx';

afterEach(cleanup);

describe('Composer 附件来源', () => {
  it('本机文件先以当前频道 resource ticket 上传，再形成可发送附件', async () => {
    const file = new File(['可信内容'], '研究 文档.md', { type: 'text/markdown' });
    const onResource = vi.fn().mockResolvedValue({ status: 'ok', ticket: 'put-once', resource_id: 'file:uploaded:1' });
    const fetchImpl = vi.fn().mockResolvedValue({ ok: true });
    const attachment = await uploadChannelFile({ file, channel: { id: 'c0', qualified_name: 'c0' }, daemonName: 'local-device', onResource, fetchImpl });
    expect(onResource).toHaveBeenCalledWith(expect.objectContaining({ channel_id: 'c0', op: 'create', address: 'daemon://local-device/c0/%E7%A0%94%E7%A9%B6-%E6%96%87%E6%A1%A3.md' }));
    // 传输只带票：URL 上没有地址，也就没有一个双方要各自拼写的编码。
    expect(fetchImpl).toHaveBeenCalledWith('/files?channel_id=c0&t=put-once', expect.objectContaining({ method: 'PUT', body: file, credentials: 'include' }));
    expect(attachment).toEqual(expect.objectContaining({ resource_id: 'file:uploaded:1', name: '研究 文档.md', media_type: 'text/markdown' }));
  });

  it('daemon 文件在独立弹层中浏览，选择后返回结构化附件', async () => {
    const user = userEvent.setup();
    const onChoose = vi.fn();
    const onClose = vi.fn();
    const onResource = vi.fn().mockResolvedValue({ items: [
      { id: 'daemon://local-device/c0/%E8%B5%84%E6%96%99/', meta: {} },
      { id: 'daemon://local-device/c0/%E8%AF%B4%E6%98%8E.md', meta: { media_type: 'text/markdown', size: 24 } },
    ] });
    // 设备行的 id 与 name 是两样东西，而 daemon 地址那一段是 name——夹具里让它们
    // 不同，这样"拿 id 去拼地址"会拼出对不上的前缀，列表直接空掉。
    render(<ChannelFilePickerModal channel={{ id: 'c0', qualified_name: 'c0' }} daemons={[{ id: 'dev-7f3a', name: 'local-device' }]} onResource={onResource} onChoose={onChoose} onClose={onClose} />);
    expect(await screen.findByRole('dialog', { name: '从频道文件选择' })).toBeTruthy();
    await user.click(await screen.findByRole('button', { name: /说明.md/ }));
    expect(onChoose).toHaveBeenCalledWith(expect.objectContaining({ resource_id: 'daemon://local-device/c0/%E8%AF%B4%E6%98%8E.md', name: '说明.md', media_type: 'text/markdown' }));
    expect(onClose).toHaveBeenCalledOnce();
  });
});
