import React, { useEffect, useState } from 'react';
import { deviceCommand, terminalValue } from '../../model/space-administration.js';
import { InlineConfirmation } from '../primitives/InlineConfirmation.jsx';
import { PanelCard } from '../primitives/PanelCard.jsx';
import { OperationState, stateFor } from './space-panel-state.jsx';

export function DevicesPanel({ channel, states, version, daemons, registrarRoster, disabled, onSubmit, onRefresh }) {
  const [error, setError] = useState('');
  const [requestId, setRequestId] = useState('');
  const [device, setDevice] = useState({ name: '', deviceId: '' });
  const [secretRequestId, setSecretRequestId] = useState('');
  const [oneTimeSecret, setOneTimeSecret] = useState(null);
  const [confirmation, setConfirmation] = useState(null);

  useEffect(() => {
    if (!secretRequestId) return;
    const result = terminalValue(stateFor(states, secretRequestId), secretRequestId);
    if (result.phase === 'completed') {
      const key = result.value?.key;
      if (key) setOneTimeSecret({ key, deviceId: result.value.device_id || result.value.id || '' });
      setSecretRequestId('');
    } else if (result.phase === 'failed') {
      setSecretRequestId('');
    }
  }, [states, secretRequestId, version]);

  async function run(action, row = null) {
    setError('');
    try {
      const values = { name: device.name, deviceId: row?.id || device.deviceId, channelId: channel.id };
      const id = await onSubmit(deviceCommand(action, values, registrarRoster));
      setRequestId(id);
      if (['mint', 'claim'].includes(action)) {
        setOneTimeSecret(null);
        setSecretRequestId(id);
      }
    } catch (failure) {
      setError(failure.message || String(failure));
    }
  }

  return <>
    {error && <p className="governance-error" role="alert">{error}</p>}
    <OperationState states={states} requestId={requestId} />
    {oneTimeSecret && <section className="secret-card" role="alert"><strong>设备密钥只显示这一次</strong><code>{oneTimeSecret.key}</code><p>现在复制并安全保存。关闭本卡或空间面板后无法再次查看。</p><button type="button" onClick={() => setOneTimeSecret(null)}>我已保存，关闭</button></section>}
    <PanelCard className="governance-form" title="签发或认领设备" action={<button type="button" className="text-button" onClick={onRefresh}>刷新安全 OBS</button>}>
      <label>设备名称<input aria-label="设备名称" value={device.name} onChange={(event) => setDevice({ ...device, name: event.target.value })} /></label>
      <label>已有设备 ID（认领时填写）<input aria-label="认领设备 ID" value={device.deviceId} onChange={(event) => setDevice({ ...device, deviceId: event.target.value })} /></label>
      <div className="form-actions"><button type="button" className="primary-button" disabled={disabled} onClick={() => run('mint')}>签发新设备</button><button type="button" disabled={disabled} onClick={() => run('claim')}>认领设备</button></div>
    </PanelCard>
    <PanelCard title="安全设备列表">
      {daemons.map((row) => <div className="device-row" key={row.id}><div><strong>{row.name}</strong><small>{row.id} · {row.online === true ? '在线' : row.online === false ? '离线' : '状态未知'}</small></div><div><button type="button" disabled={disabled} onClick={() => setConfirmation({ action: 'attach', row })}>绑定当前频道</button><button type="button" disabled={disabled} onClick={() => setConfirmation({ action: 'detach', row })}>解绑</button><button type="button" className="danger-text" disabled={disabled} onClick={() => setConfirmation({ action: 'retire', row })}>退役</button></div></div>)}
      {!daemons.length && <p className="governance-empty">安全 OBS 中没有设备。</p>}
      <p className="protected-note">列表只来自安全 OBS；界面从不调用可能返回 key 的 device.list。</p>
    </PanelCard>
    {confirmation && <InlineConfirmation title={`确认${confirmation.action === 'attach' ? '绑定' : confirmation.action === 'detach' ? '解绑' : '退役'} ${confirmation.row.name}？`} description={confirmation.action === 'attach' ? `设备将获得频道 ${channel.qualified_name || channel.id} 的放置关系；最终运行状态仍以服务端投影为准。` : confirmation.action === 'detach' ? '设备将停止承载当前频道，正在运行的服务可能迁移或暂时不可用。' : '设备身份和已有频道绑定将被撤销；本操作不可由前端恢复。'} tone={confirmation.action === 'retire' ? 'danger' : 'normal'} onCancel={() => setConfirmation(null)} onConfirm={() => { run(confirmation.action, confirmation.row); setConfirmation(null); }} />}
  </>;
}
