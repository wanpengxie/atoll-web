import React, { useEffect, useState } from 'react';
import { actorTemplateCommand, channelTemplateCommand, deviceCommand, isProtectedDeclaration, overlayCommand, parseJSONObject, profileCommand, terminalValue } from '../model/space-administration.js';

function stateFor(states, id) {
  return states.find((state) => state?.turns?.has(id)) || states[0];
}

function resultRows(states, id) {
  const value = terminalValue(stateFor(states, id), id).value;
  if (Array.isArray(value)) return value;
  return value?.items || value?.templates || value?.declarations || [];
}

function ResultState({ states, requestId }) {
  if (!requestId) return null;
  const result = terminalValue(stateFor(states, requestId), requestId);
  return <p className={`operation-state state-${result.phase}`} role="status">{result.phase === 'completed' ? '账本已完成' : result.phase === 'failed' ? `失败：${result.error}` : '请求已提交，等待账本终态'}</p>;
}

export function SpaceAdministration({ channel, channels, roster, registrarRoster, state, rootState, version = 0, daemons, disabled, onSubmit, onRefresh, onClose }) {
  const [tab, setTab] = useState('actors');
  const [error, setError] = useState('');
  const [requestId, setRequestId] = useState('');
  const [listIds, setListIds] = useState({ actors: '', channels: '' });
  const [actor, setActor] = useState({ id: '', name: '', class: 'agent', description: '', visibility: 'private', config: '{}' });
  const [template, setTemplate] = useState({ id: '', name: '', description: '', visibility: 'private', body: '{\n  "declarations": []\n}' });
  const [overlay, setOverlay] = useState({ declId: '', config: '{}' });
  const [profile, setProfile] = useState({ description: '', serving: '1', endpoints: '{}' });
  const [device, setDevice] = useState({ name: '', deviceId: '' });
  const [secretRequestId, setSecretRequestId] = useState('');
  const [oneTimeSecret, setOneTimeSecret] = useState(null);
  const [deviceConfirmation, setDeviceConfirmation] = useState(null);
  const states = [state, rootState];
  const actorRows = resultRows(states, listIds.actors);
  const templateRows = resultRows(states, listIds.channels);

  useEffect(() => {
    if (!secretRequestId) return;
    const result = terminalValue(stateFor(states, secretRequestId), secretRequestId);
    if (result.phase === 'completed') {
      const key = result.value?.key;
      if (key) setOneTimeSecret({ key, deviceId: result.value.device_id || result.value.id || '' });
      setSecretRequestId('');
    } else if (result.phase === 'failed') setSecretRequestId('');
  }, [state, rootState, secretRequestId, requestId, version]);

  async function run(command, options = {}) {
    setError('');
    try {
      const id = await onSubmit(command);
      setRequestId(id);
      if (options.list) setListIds((current) => ({ ...current, [options.list]: id }));
      if (options.secret) { setOneTimeSecret(null); setSecretRequestId(id); }
    } catch (failure) { setError(failure.message || String(failure)); }
  }

  function actorAction(action) {
    run(actorTemplateCommand(action, { ...actor, config: parseJSONObject(actor.config, 'Actor config') }, registrarRoster), action === 'list' ? { list: 'actors' } : {});
  }

  function templateAction(action) {
    run(channelTemplateCommand(action, { ...template, body: parseJSONObject(template.body, '模板 body') }, registrarRoster), action === 'list' ? { list: 'channels' } : {});
  }

  function configureOverlay(clear = false) {
    run(overlayCommand({ channelId: channel.id, declId: overlay.declId, config: parseJSONObject(overlay.config, 'Overlay config'), clear, roster }));
  }

  function configureProfile() {
    run(profileCommand({ channelId: channel.id, description: profile.description, serving: Number(profile.serving), endpoints: parseJSONObject(profile.endpoints, 'Endpoints'), roster }));
  }

  function runDevice(action, row = null) {
    const values = { name: device.name, deviceId: row?.id || device.deviceId, channelId: channel.id };
    run(deviceCommand(action, values, registrarRoster), ['mint', 'claim'].includes(action) ? { secret: true } : {});
  }

  return <aside className="governance-panel space-administration" aria-label="空间管理">
    <header><div><p className="eyebrow">SPACE CONTROL</p><h2>空间管理</h2></div><button type="button" className="icon-button" onClick={onClose} aria-label="关闭空间管理">×</button></header>
    <nav aria-label="空间管理区域">{[['actors', 'Actor 模板'], ['channels', '频道模板'], ['config', '频道配置'], ['devices', '设备']].map(([id, label]) => <button type="button" key={id} className={tab === id ? 'active' : ''} onClick={() => { setTab(id); setError(''); }}>{label}</button>)}</nav>
    <div className="governance-scroll">
      {error && <p className="governance-error" role="alert">{error}</p>}
      <ResultState states={states} requestId={requestId} />
      {tab === 'actors' && <>
        <section className="governance-card"><header><h3>已登记声明</h3><button type="button" className="text-button" disabled={disabled} onClick={() => actorAction('list')}>从 Registrar 读取</button></header>{actorRows.map((row) => <button className="template-row" type="button" key={row.id} onClick={() => setActor({ id: row.id, name: row.name || '', class: row.class || '', description: row.description || '', visibility: row.visibility || 'private', config: JSON.stringify(row.config || {}, null, 2) })}><strong>{row.name || row.id}</strong><small>{row.id} · {row.class || 'class 未知'}</small>{isProtectedDeclaration(row.id) && <span>系统保护</span>}</button>)}{!actorRows.length && <p className="governance-empty">点击读取，以账本终态获得模板列表。</p>}</section>
        <section className="governance-card governance-form"><h3>登记或编辑 Actor 模板</h3><label>声明 ID<input aria-label="Actor 声明 ID" value={actor.id} onChange={(e) => setActor({ ...actor, id: e.target.value })} placeholder="team:assistant" /></label><label>名称<input aria-label="Actor 模板名称" value={actor.name} onChange={(e) => setActor({ ...actor, name: e.target.value })} /></label><label>Class<input aria-label="Actor Class" value={actor.class} onChange={(e) => setActor({ ...actor, class: e.target.value })} /></label><label>说明<input aria-label="Actor 模板说明" value={actor.description} onChange={(e) => setActor({ ...actor, description: e.target.value })} /></label><label>可见性<select aria-label="Actor 模板可见性" value={actor.visibility} onChange={(e) => setActor({ ...actor, visibility: e.target.value })}><option value="private">private</option><option value="public">public</option></select></label><label>Config JSON<textarea aria-label="Actor Config JSON" rows="5" value={actor.config} onChange={(e) => setActor({ ...actor, config: e.target.value })} /></label><div className="form-actions"><button type="button" className="primary-button" disabled={disabled} onClick={() => actorAction('register')}>登记</button><button type="button" disabled={disabled || isProtectedDeclaration(actor.id)} onClick={() => actorAction('edit')}>保存编辑</button><button type="button" className="danger-text" disabled={disabled || isProtectedDeclaration(actor.id)} onClick={() => actorAction('revoke')}>撤销</button></div></section>
      </>}
      {tab === 'channels' && <>
        <section className="governance-card"><header><h3>频道模板</h3><button type="button" className="text-button" disabled={disabled} onClick={() => templateAction('list')}>从 Registrar 读取</button></header>{templateRows.map((row) => <button className="template-row" type="button" key={row.id} onClick={() => setTemplate({ id: row.id, name: row.name || '', description: row.description || '', visibility: row.visibility || 'private', body: JSON.stringify(row.body || {}, null, 2) })}><strong>{row.name || row.id}</strong><small>{row.id}</small></button>)}{!templateRows.length && <p className="governance-empty">尚未读取频道模板。</p>}</section>
        <section className="governance-card governance-form"><h3>登记或编辑频道模板</h3><label>模板 ID<input aria-label="频道模板 ID" value={template.id} onChange={(e) => setTemplate({ ...template, id: e.target.value })} /></label><label>名称<input aria-label="频道模板名称" value={template.name} onChange={(e) => setTemplate({ ...template, name: e.target.value })} /></label><label>说明<input aria-label="频道模板说明" value={template.description} onChange={(e) => setTemplate({ ...template, description: e.target.value })} /></label><label>Body JSON<textarea aria-label="频道模板 Body JSON" rows="8" value={template.body} onChange={(e) => setTemplate({ ...template, body: e.target.value })} /></label><div className="form-actions"><button type="button" className="primary-button" disabled={disabled} onClick={() => templateAction('register')}>登记</button><button type="button" disabled={disabled} onClick={() => templateAction('edit')}>保存编辑</button><button type="button" onClick={() => templateAction('get')} disabled={disabled}>读取详情</button><button type="button" className="danger-text" disabled={disabled} onClick={() => templateAction('revoke')}>撤销</button></div></section>
      </>}
      {tab === 'config' && <>
        <section className="governance-card governance-form"><h3>当前频道 Overlay</h3><p>配置只作用于来源频道 <strong>{channel.qualified_name || channel.id}</strong>。</p><label>声明 ID<input aria-label="Overlay 声明 ID" value={overlay.declId} onChange={(e) => setOverlay({ ...overlay, declId: e.target.value })} /></label><label>Config JSON<textarea aria-label="Overlay Config JSON" rows="6" value={overlay.config} onChange={(e) => setOverlay({ ...overlay, config: e.target.value })} /></label><div className="form-actions"><button type="button" className="primary-button" disabled={disabled} onClick={() => configureOverlay(false)}>应用 Overlay</button><button type="button" className="danger-text" disabled={disabled} onClick={() => configureOverlay(true)}>清除</button></div></section>
        <section className="governance-card governance-form"><h3>频道 Profile 与 Endpoint</h3><div className={channel.open === true ? 'observed-runtime online' : 'observed-runtime waiting'}><span>OBS 运行投影</span><strong>{channel.open === true ? '服务中' : channel.open === false ? '未服务' : '状态未知'}</strong></div><label>说明<input aria-label="Profile 说明" value={profile.description} onChange={(e) => setProfile({ ...profile, description: e.target.value })} /></label><label>Serving 数量<input aria-label="Profile Serving" type="number" min="0" value={profile.serving} onChange={(e) => setProfile({ ...profile, serving: e.target.value })} /></label><label>Endpoints JSON<textarea aria-label="Profile Endpoints JSON" rows="8" value={profile.endpoints} onChange={(e) => setProfile({ ...profile, endpoints: e.target.value })} /></label><button type="button" className="primary-button" disabled={disabled} onClick={configureProfile}>保存 Profile</button><p className="protected-note">“账本已完成”表示配置请求落账；上方状态是独立轮询的 OBS 应用证据。</p></section>
      </>}
      {tab === 'devices' && <>
        {oneTimeSecret && <section className="secret-card" role="alert"><strong>设备密钥只显示这一次</strong><code>{oneTimeSecret.key}</code><p>现在复制并安全保存。关闭本卡或空间面板后无法再次查看。</p><button type="button" onClick={() => setOneTimeSecret(null)}>我已保存，关闭</button></section>}
        <section className="governance-card governance-form"><header><h3>签发或认领设备</h3><button type="button" className="text-button" onClick={onRefresh}>刷新安全 OBS</button></header><label>设备名称<input aria-label="设备名称" value={device.name} onChange={(e) => setDevice({ ...device, name: e.target.value })} /></label><label>已有设备 ID（认领时填写）<input aria-label="认领设备 ID" value={device.deviceId} onChange={(e) => setDevice({ ...device, deviceId: e.target.value })} /></label><div className="form-actions"><button type="button" className="primary-button" disabled={disabled} onClick={() => runDevice('mint')}>签发新设备</button><button type="button" disabled={disabled} onClick={() => runDevice('claim')}>认领设备</button></div></section>
        <section className="governance-card"><h3>安全设备列表</h3>{daemons.map((row) => <div className="device-row" key={row.id}><div><strong>{row.name}</strong><small>{row.id} · {row.online === true ? '在线' : row.online === false ? '离线' : '状态未知'}</small></div><div><button type="button" disabled={disabled} onClick={() => setDeviceConfirmation({ action: 'attach', row })}>绑定当前频道</button><button type="button" disabled={disabled} onClick={() => setDeviceConfirmation({ action: 'detach', row })}>解绑</button><button type="button" className="danger-text" disabled={disabled} onClick={() => setDeviceConfirmation({ action: 'retire', row })}>退役</button></div></div>)}{!daemons.length && <p className="governance-empty">安全 OBS 中没有设备。</p>}<p className="protected-note">列表只来自安全 OBS；界面从不调用可能返回 key 的 device.list。</p></section>
        {deviceConfirmation && <section className="governance-card confirmation" role="alertdialog" aria-label="确认设备操作"><h3>确认{deviceConfirmation.action === 'attach' ? '绑定' : deviceConfirmation.action === 'detach' ? '解绑' : '退役'} {deviceConfirmation.row.name}？</h3><p>{deviceConfirmation.action === 'attach' ? `设备将获得频道 ${channel.qualified_name || channel.id} 的放置关系；最终运行状态仍以服务端投影为准。` : deviceConfirmation.action === 'detach' ? '设备将停止承载当前频道，正在运行的服务可能迁移或暂时不可用。' : '设备身份和已有频道绑定将被撤销；本操作不可由前端恢复。'}</p><div><button type="button" onClick={() => setDeviceConfirmation(null)}>取消</button><button type="button" className={deviceConfirmation.action === 'retire' ? 'danger-button' : 'primary-button'} onClick={() => { runDevice(deviceConfirmation.action, deviceConfirmation.row); setDeviceConfirmation(null); }}>确认操作</button></div></section>}
      </>}
    </div>
  </aside>;
}
