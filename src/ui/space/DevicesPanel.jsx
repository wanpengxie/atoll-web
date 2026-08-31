import React, { useEffect, useRef, useState } from 'react';
import { DEVICE_NAME_RULE, deviceCommand, terminalValue } from '../../model/space-administration.js';
import { InlineConfirmation } from '../primitives/InlineConfirmation.jsx';
import { PanelCard } from '../primitives/PanelCard.jsx';
import { OperationState, stateFor } from './space-panel-state.jsx';

export function DevicesPanel({ channel, states, version, daemons, channelDevices = [], registrarRoster, disabled, onSubmit, onRefresh }) {
  const [error, setError] = useState('');
  const [requestId, setRequestId] = useState('');
  const [deviceName, setDeviceName] = useState('');
  const [secretRequestId, setSecretRequestId] = useState('');
  const [oneTimeSecret, setOneTimeSecret] = useState(null);
  const [confirmation, setConfirmation] = useState(null);
  const refreshedRequestRef = useRef('');

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

  useEffect(() => {
    if (!requestId || refreshedRequestRef.current === requestId) return;
    const phase = stateFor(states, requestId)?.turns?.get(requestId)?.terminal?.payload?.status;
    if (!['completed', 'failed'].includes(phase)) return;
    refreshedRequestRef.current = requestId;
    onRefresh?.();
  }, [onRefresh, requestId, states, version]);

  async function run(action, row = null) {
    setError('');
    try {
      const values = { name: deviceName, deviceId: row?.id || '', channelId: channel.id };
      const id = await onSubmit(deviceCommand(action, values, registrarRoster));
      setRequestId(id);
      if (action === 'create') {
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
    <PanelCard className="governance-form" title="创建设备身份" action={<button type="button" className="text-button" onClick={onRefresh}>刷新设备状态</button>}>
      <label>设备名称<input aria-label="设备名称" value={deviceName} onChange={(event) => setDeviceName(event.target.value)} /></label>
      <p className="field-hint">{DEVICE_NAME_RULE}</p>
      <div className="form-actions"><button type="button" className="primary-button" disabled={disabled} onClick={() => run('create')}>创建设备</button></div>
    </PanelCard>
    <PanelCard title="空间设备列表">
      {daemons.map((row) => {
        const binding = channelDevices.find((candidate) => candidate.id === row.id);
        const status = binding ? binding.online : row.online;
        return <div className="device-row" key={row.id}><div><strong>{row.name}</strong><small>{row.id} · {status === true ? '在线' : status === false ? '离线' : '状态未知'}{binding ? ` · 已绑定${binding.defaultStorage ? ' · 默认存储' : ''}` : ''}</small></div><div><button type="button" disabled={disabled || Boolean(binding)} onClick={() => setConfirmation({ action: 'attach', row })}>绑定当前频道</button><button type="button" disabled={disabled || !binding} onClick={() => setConfirmation({ action: 'detach', row })}>解绑</button><button type="button" className="danger-text" disabled={disabled} onClick={() => setConfirmation({ action: 'retire', row })}>退役</button></div></div>;
      })}
      {!daemons.length && <p className="governance-empty">安全 OBS 中没有设备。</p>}
      <p className="protected-note">空间列表用于设备身份管理；“已绑定、默认存储、在线”来自当前频道的设备投影。</p>
    </PanelCard>
    {confirmation && <InlineConfirmation title={`确认${confirmation.action === 'attach' ? '绑定' : confirmation.action === 'detach' ? '解绑' : '退役'} ${confirmation.row.name}？`} description={confirmation.action === 'attach' ? `设备将获得频道 ${channel.qualified_name || channel.id} 的放置关系；最终运行状态仍以服务端投影为准。` : confirmation.action === 'detach' ? '设备将停止承载当前频道，正在运行的服务可能迁移或暂时不可用。' : '设备身份和已有频道绑定将被撤销；本操作不可由前端恢复。'} tone={confirmation.action === 'retire' ? 'danger' : 'normal'} onCancel={() => setConfirmation(null)} onConfirm={() => { run(confirmation.action, confirmation.row); setConfirmation(null); }} />}
  </>;
}
