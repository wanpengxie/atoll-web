import React, { useState } from 'react';
import { GOVERNANCE_TYPES, registryCommand } from '../../model/channel-governance.js';
import { PanelCard } from '../primitives/PanelCard.jsx';

export function ChannelDangerPanel({ channel, roster, disabled, onSubmit }) {
  const [retireText, setRetireText] = useState('');
  const [error, setError] = useState('');
  const expected = channel.qualified_name || channel.name || channel.id;

  async function retire() {
    if (retireText !== expected) return;
    setError('');
    try {
      await onSubmit(registryCommand({ channelId: channel.id, type: GOVERNANCE_TYPES.retire, payload: { channel_id: channel.id }, roster }));
      setRetireText('');
    } catch (failure) {
      setError(failure.message || String(failure));
    }
  }

  return <>
    {error && <p className="governance-error" role="alert">{error}</p>}
    <PanelCard className="danger-zone" title="退役频道">
      {channel.id === 'c0' ? <p>空间根频道 c0 受后端保护，不能退役。</p> : <>
        <p>退役后频道停止写入，但已有账本和文件不会被前端删除。存在活动子频道时后端会拒绝。</p>
        <label>输入 <strong>{expected}</strong> 确认<input aria-label="退役确认" value={retireText} onChange={(event) => setRetireText(event.target.value)} /></label>
        <button type="button" className="danger-button" disabled={disabled || retireText !== expected} onClick={retire}>退役当前频道</button>
      </>}
    </PanelCard>
  </>;
}
