import React, { useState } from 'react';
import { overlayCommand, parseJSONObject, profileCommand } from '../../model/space-administration.js';
import { PanelCard } from '../primitives/PanelCard.jsx';
import { OperationState } from './space-panel-state.jsx';

export function ChannelConfigurationPanel({ channel, roster, states, disabled, onSubmit }) {
  const [error, setError] = useState('');
  const [requestId, setRequestId] = useState('');
  const [overlay, setOverlay] = useState({ declId: '', config: '{}' });
  const [profile, setProfile] = useState({ description: '', serving: '1', endpoints: '{}' });

  async function run(makeCommand) {
    setError('');
    try {
      const id = await onSubmit(makeCommand());
      setRequestId(id);
    } catch (failure) {
      setError(failure.message || String(failure));
    }
  }

  function configureOverlay(clear = false) {
    run(() => overlayCommand({ channelId: channel.id, declId: overlay.declId, config: parseJSONObject(overlay.config, 'Overlay config'), clear, roster }));
  }

  function configureProfile() {
    run(() => profileCommand({ channelId: channel.id, description: profile.description, serving: Number(profile.serving), endpoints: parseJSONObject(profile.endpoints, 'Endpoints'), roster }));
  }

  return <>
    {error && <p className="governance-error" role="alert">{error}</p>}
    <OperationState states={states} requestId={requestId} />
    <PanelCard className="governance-form" title="当前频道 Overlay">
      <p>配置只作用于来源频道 <strong>{channel.qualified_name || channel.id}</strong>。</p>
      <label>声明 ID<input aria-label="Overlay 声明 ID" value={overlay.declId} onChange={(event) => setOverlay({ ...overlay, declId: event.target.value })} /></label>
      <label>Config JSON<textarea aria-label="Overlay Config JSON" rows="6" value={overlay.config} onChange={(event) => setOverlay({ ...overlay, config: event.target.value })} /></label>
      <div className="form-actions"><button type="button" className="primary-button" disabled={disabled} onClick={() => configureOverlay(false)}>应用 Overlay</button><button type="button" className="danger-text" disabled={disabled} onClick={() => configureOverlay(true)}>清除</button></div>
    </PanelCard>
    <PanelCard className="governance-form" title="频道 Profile 与 Endpoint">
      <div className={channel.open === true ? 'observed-runtime online' : 'observed-runtime waiting'}><span>OBS 运行投影</span><strong>{channel.open === true ? '服务中' : channel.open === false ? '未服务' : '状态未知'}</strong></div>
      <label>说明<input aria-label="Profile 说明" value={profile.description} onChange={(event) => setProfile({ ...profile, description: event.target.value })} /></label>
      <label>Serving 数量<input aria-label="Profile Serving" type="number" min="0" value={profile.serving} onChange={(event) => setProfile({ ...profile, serving: event.target.value })} /></label>
      <label>Endpoints JSON<textarea aria-label="Profile Endpoints JSON" rows="8" value={profile.endpoints} onChange={(event) => setProfile({ ...profile, endpoints: event.target.value })} /></label>
      <button type="button" className="primary-button" disabled={disabled} onClick={configureProfile}>保存 Profile</button>
      <p className="protected-note">“账本已完成”表示配置请求落账；上方状态是由 WS 失效信号刷新得到的独立 OBS 应用证据。</p>
    </PanelCard>
  </>;
}
