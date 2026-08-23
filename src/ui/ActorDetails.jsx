import React, { useEffect, useMemo, useState } from 'react';
import { actorDisplayName } from '../model/actor-display.js';
import { capabilityRisk, typeSupportsRequest } from '../model/capabilities.js';
import { TYPES } from '../protocol/vocab.js';
import { buildFormSpec, valuesToPayload } from '../model/dynamic-form.js';
import { DynamicFields, initialFieldValues } from './DynamicFields.jsx';

const RISK_LABEL = { normal: '普通', medium: '任务控制', high: '高风险', critical: '极高风险' };
const CONTROL_LABEL = {
  [TYPES.agentAsk]: '提问',
  [TYPES.agentSteer]: '插入',
  [TYPES.agentInterrupt]: '停止',
  [TYPES.agentHold]: '暂停等待区',
  [TYPES.agentUnhold]: '继续等待区',
  [TYPES.agentReplace]: '修改排队任务',
  [TYPES.agentQueue]: '排队新任务',
  [TYPES.agentFork]: '分叉出新 Agent',
  [TYPES.agentCompact]: '压缩上下文',
  [TYPES.agentNew]: '新建对话',
  [TYPES.agentSelect]: '切换模型与算力',
  [TYPES.agentContext]: '查看上下文用量',
};

function CapabilityForm({ actor, type, meta, disabled, onInvoke, onClose }) {
  const spec = useMemo(() => buildFormSpec(type, meta), [meta, type]);
  const [values, setValues] = useState(() => initialFieldValues(spec));
  const [rawJSON, setRawJSON] = useState(() => JSON.stringify(spec.initial || {}, null, 2));
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [confirmId, setConfirmId] = useState('');
  const risk = capabilityRisk(type);

  useEffect(() => {
    setValues(initialFieldValues(spec));
    setRawJSON(JSON.stringify(spec.initial || {}, null, 2));
    setError('');
    setConfirmed(false);
    setConfirmId('');
    // OBS 会在 WS 失效事件或手动刷新后重建 capability 对象；编辑中的表单不能因此被 payload_example 覆盖。
    // 只有切换 Actor 或能力类型时才重置用户输入。
  }, [actor.id, type]);

  const confirmationOK = risk === 'critical' ? confirmId === actor.id : risk === 'high' ? confirmed : true;

  async function submit() {
    setError('');
    try {
      const payload = valuesToPayload(spec, values, rawJSON);
      setSubmitting(true);
      await onInvoke(type, payload);
      onClose();
    } catch (failure) {
      setError(failure.message || String(failure));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <section className={`capability-form risk-${risk}`} aria-label={`${CONTROL_LABEL[type] || type} 参数`}>
      <header><div><strong>{CONTROL_LABEL[type] || type}</strong><span>{meta.description || '该能力没有文字说明'}</span></div><button type="button" onClick={onClose} aria-label="关闭能力表单">×</button></header>
      {spec.mode === 'fields' ? <DynamicFields className="capability-fields" spec={spec} values={values} onChange={(name, value) => { setValues((current) => ({ ...current, [name]: value })); setError(''); }} /> : (
        <label className="raw-payload-field"><span>JSON 参数</span><small>{spec.reason}</small><textarea rows={8} value={rawJSON} onChange={(event) => { setRawJSON(event.target.value); setError(''); }} /></label>
      )}
      {risk === 'high' && <label className="risk-confirm"><input type="checkbox" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} />我理解此操作会中断或重置 Agent 的当前工作</label>}
      {risk === 'critical' && <label className="risk-confirm"><span>请输入 Actor ID <code>{actor.id}</code> 确认终止</span><input value={confirmId} onChange={(event) => setConfirmId(event.target.value)} /></label>}
      {error && <p className="capability-error" role="alert">{error}</p>}
      <div className="capability-form-actions"><button type="button" onClick={onClose}>取消</button><button type="button" className="primary" onClick={submit} disabled={disabled || submitting || !confirmationOK}>{submitting ? '提交中…' : '提交操作'}</button></div>
    </section>
  );
}

export function ActorDetails({ actor, capability, disabled = false, onDescribe, onInvoke, onClose }) {
  const [activeType, setActiveType] = useState('');
  const describe = capability?.describe;
  const types = describe ? [...describe.types.values()].sort((left, right) => left.type.localeCompare(right.type)) : [];
  const activeMeta = describe?.types.get(activeType);

  useEffect(() => setActiveType(''), [actor?.id]);
  if (!actor) return null;

  return (
    <section className="actor-details" aria-label={`Actor 详情 ${actorDisplayName(actor)}`}>
      <header className="actor-details-header"><div><p className="eyebrow">ACTOR CAPABILITIES</p><h3>{actorDisplayName(actor)}</h3><code>{actor.id}</code></div><button type="button" onClick={onClose} aria-label="关闭 Actor 详情">×</button></header>
      <div className="actor-details-scroll">
        <p className="actor-details-description">{actor.description || (describe ? `${describe.className}（${describe.interfaces.join(' / ')}）` : '尚未读取 Actor 自述能力。')}</p>
        {describe && Object.keys(describe.capabilities).length > 0 && (
          <p className="actor-capability-flags">运行时能力：{Object.entries(describe.capabilities).filter(([, on]) => on).map(([name]) => name).join('、') || '无'}</p>
        )}
        <div className="describe-toolbar"><span>{capability?.loading ? '正在读取能力…' : describe ? `${types.length} 项能力` : '能力未知'}</span><button type="button" onClick={onDescribe} disabled={disabled || capability?.loading}>{describe ? '刷新能力' : '读取能力'}</button></div>
        {capability?.error && <p className="describe-error" role="alert"><strong>{capability.error.code}</strong>{capability.error.detail}</p>}
        <div className="capability-list">{types.map((meta) => {
          const risk = capabilityRisk(meta.type);
          const supported = typeSupportsRequest(meta);
          const conversationAction = Object.prototype.hasOwnProperty.call(CONTROL_LABEL, meta.type);
          return (
            <article className={`capability-row risk-${risk}`} key={meta.type}>
              <div><strong>{CONTROL_LABEL[meta.type] || meta.type}</strong><code>{meta.type}</code><p>{meta.description || '无描述'}</p></div>
              <div className="capability-meta"><span>{RISK_LABEL[risk]}</span></div>
              {meta.errorCodes.length > 0 && <details><summary>可能的错误</summary>{meta.errorCodes.map((item) => <p key={item.code}><code>{item.code}</code></p>)}</details>}
              <button type="button" onClick={() => setActiveType(meta.type)} disabled={disabled || !supported || conversationAction || meta.type === TYPES.describe}>{conversationAction ? '使用对话操作' : supported ? '调用' : '仅事件能力'}</button>
            </article>
          );
        })}{describe && !types.length && <p className="roster-empty">该 Actor 未声明可调用类型</p>}</div>
      </div>
      {activeType && activeMeta && <CapabilityForm actor={actor} type={activeType} meta={activeMeta} disabled={disabled} onInvoke={onInvoke} onClose={() => setActiveType('')} />}
    </section>
  );
}
