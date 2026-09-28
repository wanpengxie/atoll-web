import React, { useEffect, useMemo, useRef, useState } from 'react';
import { GLOBAL_PREFIX } from '../../../model/global-keys.js';
import {
  insertGlobalReference,
  isEditableMemberKind,
  MEMBER_LAYER_NAMES,
  memberConfigPatch,
  memberLayerLabel,
  memberSourceLabel,
  missingGlobalReferences,
  parseMemberConfigText,
} from '../../../model/member-config.js';

function errorText(error) {
  const detail = error?.detail || error?.message || String(error);
  return error?.code && !String(detail).includes(error.code) ? `${error.code}：${detail}` : detail;
}

function sinceLabel(since) {
  const date = new Date(Number(since));
  if (!Number.isFinite(date.getTime()) || Number(since) <= 0) return '';
  return new Intl.DateTimeFormat('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }).format(date);
}

// 成员的两层。标准层（能力、连接）先就绪，业务层（class 构造 + Proc）在它之上
// 初始化；没就绪的那层给出原因和进入这个状态的时间。
export function MemberLayers({ member }) {
  const layers = ['standard', 'business'].filter((layer) => member?.[layer]?.state);
  if (!layers.length) return <p className="governance-empty">名册还没有这个成员的两层状态。</p>;
  return <dl className="member-layers" aria-label="成员两层状态">
    {layers.map((layer) => {
      const value = member[layer];
      const ready = value.state === 'ready';
      const since = !ready ? sinceLabel(value.since) : '';
      return <div className={`member-layer layer-${value.state}`} key={layer} data-layer={layer}>
        <dt>{MEMBER_LAYER_NAMES[layer]}</dt>
        <dd>
          <strong>{memberLayerLabel(layer, value.state)}</strong>
          {!ready && value.reason && <span className="member-layer-reason">{value.reason}</span>}
          {since && <small>自 {since}</small>}
        </dd>
      </div>;
    })}
  </dl>;
}

function MemberConfigEditor({ actor, info, commands, globalKeys, disabled, onSaved, onCancel }) {
  const [klass, setKlass] = useState(String(info?.class || ''));
  const [text, setText] = useState(() => JSON.stringify(info?.config || {}, null, 2));
  const [keys, setKeys] = useState(null);
  const [keysError, setKeysError] = useState('');
  const [pick, setPick] = useState('');
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [preview, setPreview] = useState(null);
  const textRef = useRef(null);
  const parsed = useMemo(() => {
    try { return { config: parseMemberConfigText(text), error: '' }; }
    catch (failure) { return { config: null, error: failure.message }; }
  }, [text]);
  const patch = parsed.config ? memberConfigPatch(info?.config, parsed.config) : null;
  const nextClass = klass.trim();
  const classChanged = Boolean(nextClass) && nextClass !== String(info?.class || '');
  const changed = classChanged || Boolean(patch && Object.keys(patch).length);
  const missing = parsed.config && Array.isArray(keys) ? missingGlobalReferences(parsed.config, keys) : [];
  const listKeys = globalKeys?.commands?.list;

  // 打开编辑器是一次真人动作：这时读一次全局 key 名单，给插入引用用。
  useEffect(() => {
    if (globalKeys?.available !== true || typeof listKeys !== 'function') return undefined;
    let active = true;
    Promise.resolve(listKeys()).then((names) => {
      if (!active) return;
      setKeys(Array.isArray(names) ? names : []);
      setPick((current) => current || (Array.isArray(names) && names[0]) || '');
    }).catch((failure) => { if (active) setKeysError(errorText(failure)); });
    return () => { active = false; };
  }, [globalKeys?.available, listKeys]);

  const insert = () => {
    if (!pick) return;
    const element = textRef.current;
    const { text: next, cursor } = insertGlobalReference(text, element?.selectionStart, element?.selectionEnd, pick);
    setText(next);
    setPreview(null);
    requestAnimationFrame(() => {
      if (!element?.isConnected) return;
      element.focus();
      element.setSelectionRange(cursor, cursor);
    });
  };

  const submit = async (dryRun) => {
    if (!parsed.config) return;
    setBusy(dryRun ? 'dry-run' : 'save');
    setError('');
    if (!dryRun) setPreview(null);
    try {
      const reply = await commands.setMember({ actor, klass: classChanged ? nextClass : '', config: patch, dryRun });
      if (dryRun) setPreview(reply || {});
      else onSaved(reply || {});
    } catch (failure) {
      setError(errorText(failure));
    } finally {
      setBusy('');
    }
  };

  const locked = disabled || Boolean(busy);
  return <form className="governance-form member-config-editor" aria-label="编辑成员配置" onSubmit={(event) => { event.preventDefault(); void submit(false); }}>
    <label>Class<input aria-label="成员 Class" value={klass} disabled={locked} onChange={(event) => { setKlass(event.target.value); setPreview(null); }} /></label>
    <label>配置 JSON<textarea
      ref={textRef}
      aria-label="成员配置 JSON"
      rows="12"
      spellCheck={false}
      value={text}
      disabled={locked}
      aria-invalid={parsed.error ? true : undefined}
      onChange={(event) => { setText(event.target.value); setPreview(null); }}
    /></label>
    {parsed.error && <p className="field-error" role="alert">{parsed.error}</p>}
    <div className="member-config-global" role="group" aria-label="插入全局 key 引用">
      <select aria-label="选择全局 key" value={pick} disabled={locked || !keys?.length} onChange={(event) => setPick(event.target.value)}>
        {!keys?.length && <option value="">{keys ? '还没有全局 key' : globalKeys?.available === true && !keysError ? '正在读取全局 key…' : '全局 key 不可用'}</option>}
        {(keys || []).map((name) => <option key={name} value={name}>{name}</option>)}
      </select>
      <button type="button" disabled={locked || !pick} onClick={insert}>插入引用</button>
    </div>
    {keys && !keys.length && <p className="field-hint">可在「空间管理 → 全局 key」添加；配置里写 <code>"$global.&lt;名称&gt;"</code> 引用。</p>}
    {keysError && <p className="field-hint">全局 key 名单读取失败：{keysError}</p>}
    {globalKeys?.available !== true && <p className="field-hint">{globalKeys?.reason || '当前不能读取全局 key。'}</p>}
    {missing.length > 0 && <p className="field-hint member-config-missing" role="status">引用的全局 key 不存在：{missing.join('、')}</p>}
    {patch && changed && <details className="member-config-patch" open>
      <summary>将提交的变更</summary>
      <pre>{JSON.stringify({ ...(classChanged ? { class: nextClass } : {}), ...(Object.keys(patch).length ? { config: patch } : {}) }, null, 2)}</pre>
    </details>}
    {preview && <div className="member-config-preview" role="status" aria-label="检查结果">
      <strong>{preview.changed ? '检查通过：会改变配置' : '检查通过：配置不会改变'}</strong>
      {preview.class && <small>Class {preview.class}</small>}
      <pre>{JSON.stringify(preview.config ?? {}, null, 2)}</pre>
    </div>}
    {error && <p className="governance-error" role="alert">{error}</p>}
    <div className="form-actions">
      <button type="button" disabled={Boolean(busy)} onClick={onCancel}>取消</button>
      <button type="button" disabled={locked || !parsed.config || !changed} onClick={() => void submit(true)}>{busy === 'dry-run' ? '检查中…' : '检查变更'}</button>
      <button type="submit" className="primary-button" disabled={locked || !parsed.config || !changed}>{busy === 'save' ? '正在保存…' : '保存配置'}</button>
    </div>
  </form>;
}

// 成员的 class 与配置。按需读取（system.member.get 是一条账本请求，恒不自动发），
// 只有 agent / tool 可以编辑；保存发 system.member.set，config 是顶层补丁。
export function MemberConfigSection({ actor, port = {} }) {
  const commands = port.commands || {};
  const [info, setInfo] = useState(null);
  const [reading, setReading] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [editing, setEditing] = useState(false);
  const editable = isEditableMemberKind(actor?.kind);
  const readable = typeof commands.readMember === 'function';
  useEffect(() => { setInfo(null); setEditing(false); setError(''); setNotice(''); }, [actor?.id]);

  const read = async () => {
    if (!readable) return null;
    setReading(true);
    setError('');
    try {
      const value = await commands.readMember(actor);
      setInfo(value || {});
      return value;
    } catch (failure) {
      setError(errorText(failure));
      return null;
    } finally {
      setReading(false);
    }
  };

  const saved = async (reply) => {
    setEditing(false);
    setNotice(reply.changed === false
      ? '配置没有变化。'
      : reply.rebuilt ? '配置已保存，成员已按新配置重建。' : '配置已保存。');
    await read();
  };

  return <section className="panel-card member-config" aria-label="成员配置">
    <header className="panel-card-header">
      <h3>配置</h3>
      <button type="button" className="text-button" disabled={!readable || reading} onClick={() => { setNotice(''); void read(); }}>{reading ? '读取中…' : info ? '刷新配置' : '读取配置'}</button>
    </header>
    {!readable && <p className="governance-empty">当前会话不能读取成员配置。</p>}
    {readable && !info && !reading && !error && <p className="governance-empty">配置按需读取：点「读取配置」向本频道 system 发一条 system.member.get。</p>}
    {error && <p className="governance-error" role="alert">{error}</p>}
    {notice && <p className="operation-state state-completed" role="status">{notice}</p>}
    {info && <>
      <dl className="work-item-metadata member-config-facts">
        <dt>Class</dt><dd>{info.class || '—'}</dd>
        <dt>来源</dt><dd>{memberSourceLabel(info.source) || '—'}</dd>
        {info.desired_host && <><dt>部署设备</dt><dd>{info.desired_host}</dd></>}
      </dl>
      {!editing && <pre className="member-config-json" aria-label="当前配置">{JSON.stringify(info.config ?? {}, null, 2)}</pre>}
      {!editing && editable && <button type="button" className="secondary-button" disabled={port.disabled || typeof commands.setMember !== 'function'} onClick={() => { setNotice(''); setEditing(true); }}>编辑配置</button>}
      {!editable && <p className="governance-empty">只有 Agent 和工具成员有可编辑的配置。</p>}
      {editing && <MemberConfigEditor
        actor={actor}
        info={info}
        commands={commands}
        globalKeys={port.globalKeys}
        disabled={port.disabled}
        onCancel={() => setEditing(false)}
        onSaved={saved}
      />}
      {info.config && Object.values(info.config).some((value) => typeof value === 'string' && value.startsWith('$global.')) && !editing
        && <p className="field-hint">以 <code>$global.</code> 开头的是对 {GLOBAL_PREFIX}&lt;名称&gt; 的引用，不是值。</p>}
    </>}
  </section>;
}
