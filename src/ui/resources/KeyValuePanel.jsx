import React, { useState } from 'react';
import { kvResource } from '../../model/resources.js';
import { parseJSONObject } from '../../model/space-administration.js';
import { PanelCard } from '../primitives/PanelCard.jsx';

const ACTION_LABELS = { create: '创建', read: '读取', write: '写入', stat: '状态', list: '列出', delete: '删除' };

export function KeyValuePanel({ channel, disabled, onResource }) {
  const [resourceId, setResourceId] = useState('kv:demo');
  const [args, setArgs] = useState('{"value":"hello"}');
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');

  async function run(op) {
    setError('');
    try {
      const command = kvResource({ channelId: channel.id, op, id: resourceId, ...(op === 'create' || op === 'write' ? { args: parseJSONObject(args, 'KV args') } : {}) });
      setResult(await onResource(command));
    } catch (failure) {
      setError(failure.message || String(failure));
    }
  }

  return <>
    {error && <p className="governance-error" role="alert">{error}</p>}
    <PanelCard className="governance-form" title="KV 资源">
      <label>资源 ID<input aria-label="KV 资源 ID" value={resourceId} onChange={(event) => setResourceId(event.target.value)} /></label>
      <label>Args JSON<textarea aria-label="KV Args JSON" rows="6" value={args} onChange={(event) => setArgs(event.target.value)} /></label>
      <div className="resource-actions">{Object.entries(ACTION_LABELS).map(([op, label]) => <button type="button" key={op} className={op === 'delete' ? 'danger-text' : op === 'create' ? 'primary-button' : ''} disabled={disabled} onClick={() => run(op)}>{label}</button>)}</div>
    </PanelCard>
    {result && <PanelCard className="resource-result" title="最近结果"><pre>{JSON.stringify(result, null, 2)}</pre></PanelCard>}
  </>;
}
