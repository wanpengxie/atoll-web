import React, { useEffect, useMemo, useRef, useState } from 'react';
import { GLOBAL_PREFIX } from '../../../model/global-keys.js';
import {
  insertGlobalReference,
  isEditableMemberKind,
  memberBodyLabel,
  memberSourceRows,
  mergePatch,
  missingGlobalReferences,
  missingPlaceholders,
  parseMemberConfigText,
  patchAtPath,
  sameJSON,
} from '../../../model/member-config.js';
import { LOCAL_DEVICE_ID } from '../../../protocol/vocab.js';
import { BuildLine } from '../governance/BuildLine.jsx';

function errorText(error) {
  const detail = error?.detail || error?.message || String(error);
  return error?.code && !String(detail).includes(error.code) ? `${error.code}：${detail}` : detail;
}

function plainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function parseJSONObject(text, label) {
  try { return { value: parseMemberConfigText(text), error: '' }; }
  catch (failure) { return { value: null, error: `${label}：${failure.message}` }; }
}

// 全局 key 名单：打开编辑器是一次真人动作，这时读一次，给插入引用用。只在打开
// 时读——重连不会让它自己再读一遍（前端恒不自动探测）。
function useGlobalKeyNames(globalKeys) {
  const [keys, setKeys] = useState(null);
  const [error, setError] = useState('');
  const listKeysRef = useRef(null);
  listKeysRef.current = globalKeys?.available === true ? globalKeys?.commands?.list : null;
  useEffect(() => {
    const listKeys = listKeysRef.current;
    if (typeof listKeys !== 'function') return undefined;
    let active = true;
    Promise.resolve(listKeys()).then((names) => {
      if (active) setKeys(Array.isArray(names) ? names : []);
    }).catch((failure) => { if (active) setError(errorText(failure)); });
    return () => { active = false; };
  }, []);
  return { keys, error };
}

function GlobalReferencePicker({ textRef, text, setText, keys, keysError, globalKeys, disabled }) {
  const [pick, setPick] = useState('');
  const chosen = pick || keys?.[0] || '';
  const insert = () => {
    if (!chosen) return;
    const element = textRef.current;
    const { text: next, cursor } = insertGlobalReference(text, element?.selectionStart, element?.selectionEnd, chosen);
    setText(next);
    requestAnimationFrame(() => {
      if (!element?.isConnected) return;
      element.focus();
      element.setSelectionRange(cursor, cursor);
    });
  };
  return <>
    <div className="member-config-global" role="group" aria-label="插入全局 key 引用">
      <select aria-label="选择全局 key" value={chosen} disabled={disabled || !keys?.length} onChange={(event) => setPick(event.target.value)}>
        {!keys?.length && <option value="">{keys ? '还没有全局 key' : globalKeys?.available === true && !keysError ? '正在读取全局 key…' : '全局 key 不可用'}</option>}
        {(keys || []).map((name) => <option key={name} value={name}>{name}</option>)}
      </select>
      <button type="button" disabled={disabled || !chosen} onClick={insert}>插入引用</button>
    </div>
    {keys && !keys.length && <p className="field-hint">可在「空间管理 → 全局 key」添加；配置里写 <code>"$global.&lt;名称&gt;"</code> 引用。</p>}
    {keysError && <p className="field-hint">全局 key 名单读取失败：{keysError}</p>}
    {globalKeys?.available !== true && <p className="field-hint">{globalKeys?.reason || '当前不能读取全局 key。'}</p>}
  </>;
}

function EditorActions({ busy, locked, ready, onCancel, saveLabel }) {
  return <div className="form-actions">
    <button type="button" disabled={Boolean(busy)} onClick={onCancel}>取消</button>
    <button type="submit" className="primary-button" disabled={locked || !ready}>{busy === 'save' ? '正在保存…' : saveLabel}</button>
  </div>;
}

// 描述条目：成员从什么造（class，或一条 Actor 描述：描述id@版本 钉死那一版、
// 不带版本号就是最新版——频道打开时解析）、这个频道给它的 params、它声明要有的
// requires。写在 c0 的频道描述里，发 system.member.set。
function actorRefOptions(descriptions = [], current = '') {
  const options = [];
  for (const row of descriptions || []) {
    if (!row?.id) continue;
    const label = row.name || row.id;
    options.push({ value: row.id, label: `${label} · 最新版（频道打开时解析）` });
    for (let version = Number(row.version || 0); version >= 1; version -= 1) {
      options.push({ value: `${row.id}@${version}`, label: `${label} · 钉死 @${version}` });
    }
  }
  if (current && !options.some((option) => option.value === current)) options.unshift({ value: current, label: current });
  return options;
}

function MemberEntryEditor({ actor, info, commands, descriptions = [], disabled, onSaved, onCancel }) {
  const body = plainObject(info?.body) ? info.body : {};
  const [mode, setMode] = useState(body.actor ? 'actor' : 'class');
  const [ref, setRef] = useState(String(body.actor || body.class || ''));
  const [text, setText] = useState(() => JSON.stringify(plainObject(info?.params) ? info.params : {}, null, 2));
  const [requiresText, setRequiresText] = useState((Array.isArray(info?.requires) ? info.requires : []).join(', '));
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const parsed = useMemo(() => parseJSONObject(text, 'params'), [text]);
  const nextBody = ref.trim() ? { [mode]: ref.trim() } : null;
  const bodyChanged = Boolean(nextBody) && !sameJSON(nextBody, plainObject(info?.body) ? info.body : {});
  const patch = parsed.value ? mergePatch(info?.params, parsed.value) : null;
  const requires = requiresText.split(/[\s,，]+/).map((word) => word.trim()).filter(Boolean);
  const requiresChanged = !sameJSON(requires, Array.isArray(info?.requires) ? info.requires : []);
  const changed = bodyChanged || requiresChanged || Boolean(patch && Object.keys(patch).length);
  const submit = async () => {
    if (!parsed.value) return;
    setBusy('save');
    setError('');
    try {
      const reply = await commands.setMember({
        actor,
        body: bodyChanged ? nextBody : null,
        params: patch,
        ...(requiresChanged ? { requires: requires.length ? requires : null } : {}),
      });
      onSaved(`成员条目已写进频道描述（第 ${reply?.description_revision ?? '?'} 版）；成员会按新描述重建，构建结果点「刷新」查看。`);
    } catch (failure) {
      setError(errorText(failure));
    } finally {
      setBusy('');
    }
  };
  const locked = disabled || Boolean(busy);
  return <form className="governance-form member-config-editor" aria-label="编辑成员条目" onSubmit={(event) => { event.preventDefault(); void submit(); }}>
    <fieldset className="member-body-mode" disabled={locked}>
      <legend>从什么造</legend>
      <label><input type="radio" name="member-body-mode" checked={mode === 'class'} onChange={() => setMode('class')} /> Class</label>
      <label><input type="radio" name="member-body-mode" checked={mode === 'actor'} onChange={() => setMode('actor')} /> Actor 描述</label>
    </fieldset>
    {mode === 'actor'
      ? <label>Actor 描述<select aria-label="成员 Actor 描述" value={ref} disabled={locked} onChange={(event) => setRef(event.target.value)}>
        <option value="">选择一条 Actor 描述</option>
        {actorRefOptions(descriptions, body.actor ? String(body.actor) : '').map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
      </select></label>
      : <label>Class<input aria-label="成员 Class" value={ref} disabled={locked} placeholder="例如 claude" onChange={(event) => setRef(event.target.value)} /></label>}
    <label>params JSON<textarea aria-label="成员 params JSON" rows="8" spellCheck={false} value={text} disabled={locked} aria-invalid={parsed.error ? true : undefined} onChange={(event) => setText(event.target.value)} /></label>
    {parsed.error && <p className="field-error" role="alert">{parsed.error}</p>}
    <label>requires<input aria-label="成员 requires" value={requiresText} disabled={locked} placeholder="逗号分隔的词" onChange={(event) => setRequiresText(event.target.value)} /></label>
    <p className="field-hint">params 的值写 <code>"$required:说明"</code> 就是一个占位：由成员在这一台的配置里填。</p>
    {changed && <details className="member-config-patch" open>
      <summary>将提交的变更</summary>
      <pre>{JSON.stringify({ ...(bodyChanged ? { body: nextBody } : {}), ...(patch && Object.keys(patch).length ? { params: patch } : {}), ...(requiresChanged ? { requires: requires.length ? requires : null } : {}) }, null, 2)}</pre>
    </details>}
    {error && <p className="governance-error" role="alert">{error}</p>}
    <EditorActions busy={busy} locked={locked} ready={Boolean(parsed.value) && changed } onCancel={onCancel} saveLabel="保存条目" />
  </form>;
}

// 这一台的配置：它跑在哪台设备（desired_host，空 = local-device）和它的 values。
// 存在本频道的库里，发 system.member.config.set。
function MemberOwnConfigEditor({ actor, info, commands, devices, globalKeys, disabled, onSaved, onCancel }) {
  const own = plainObject(info?.own_config) ? info.own_config : {};
  const ownValues = plainObject(own.values) ? own.values : {};
  const [host, setHost] = useState(String(own.desired_host || ''));
  const [text, setText] = useState(() => JSON.stringify(ownValues, null, 2));
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const { keys, error: keysError } = useGlobalKeyNames(globalKeys);
  const textRef = useRef(null);
  const parsed = useMemo(() => parseJSONObject(text, 'values'), [text]);
  const patch = parsed.value ? mergePatch(ownValues, parsed.value) : null;
  const hostChanged = host !== String(own.desired_host || '');
  const changed = hostChanged || Boolean(patch && Object.keys(patch).length);
  const missing = parsed.value && Array.isArray(keys) ? missingGlobalReferences(parsed.value, keys) : [];
  const hostOptions = [...new Set([String(own.desired_host || ''), ...(devices || []).map((row) => row.id)].filter((id) => id && id !== LOCAL_DEVICE_ID))];
  const submit = async () => {
    if (!parsed.value) return;
    setBusy('save');
    setError('');
    try {
      const reply = await commands.setMemberConfig({ actor, ...(hostChanged ? { desiredHost: host } : {}), values: patch });
      onSaved(`这一台的配置已保存（第 ${reply?.revision ?? '?'} 版）；成员会按新配置重建，构建结果点「刷新」查看。`);
    } catch (failure) {
      setError(errorText(failure));
    } finally {
      setBusy('');
    }
  };
  const locked = disabled || Boolean(busy);
  return <form className="governance-form member-config-editor" aria-label="编辑成员配置" onSubmit={(event) => { event.preventDefault(); void submit(); }}>
    <label>运行设备<select aria-label="成员运行设备" value={host} disabled={locked} onChange={(event) => setHost(event.target.value)}>
      <option value="">local-device（默认）</option>
      {hostOptions.map((id) => <option key={id} value={id}>{(devices || []).find((row) => row.id === id)?.name || id}</option>)}
    </select></label>
    <label>values JSON<textarea
      ref={textRef}
      aria-label="成员配置 JSON"
      rows="10"
      spellCheck={false}
      value={text}
      disabled={locked}
      aria-invalid={parsed.error ? true : undefined}
      onChange={(event) => setText(event.target.value)}
    /></label>
    {parsed.error && <p className="field-error" role="alert">{parsed.error}</p>}
    <GlobalReferencePicker textRef={textRef} text={text} setText={setText} keys={keys} keysError={keysError} globalKeys={globalKeys} disabled={locked} />
    {missing.length > 0 && <p className="field-hint member-config-missing" role="status">引用的全局 key 不存在：{missing.join('、')}</p>}
    {changed && <details className="member-config-patch" open>
      <summary>将提交的变更</summary>
      <pre>{JSON.stringify({ ...(hostChanged ? { desired_host: host } : {}), ...(patch && Object.keys(patch).length ? { values: patch } : {}) }, null, 2)}</pre>
    </details>}
    {error && <p className="governance-error" role="alert">{error}</p>}
    <EditorActions busy={busy} locked={locked} ready={Boolean(parsed.value) && changed } onCancel={onCancel} saveLabel="保存配置" />
  </form>;
}

// 还没填的占位：每个给一个输入框，填了直接写进这一台的配置。
function MissingPlaceholders({ actor, info, commands, disabled, onSaved }) {
  const missing = missingPlaceholders(info);
  const [values, setValues] = useState({});
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  if (!missing.length) return null;
  const fill = async (key) => {
    const value = String(values[key] ?? '');
    if (!value) return;
    setBusy(key);
    setError('');
    try {
      const reply = await commands.setMemberConfig({ actor, values: patchAtPath(key, value) });
      setValues((current) => ({ ...current, [key]: '' }));
      onSaved(`已填 ${key}（配置第 ${reply?.revision ?? '?'} 版）；成员会重建，构建结果点「刷新」查看。`);
    } catch (failure) {
      setError(errorText(failure));
    } finally {
      setBusy('');
    }
  };
  const writable = typeof commands.setMemberConfig === 'function';
  return <div className="member-missing" role="group" aria-label="还没填的占位">
    <strong>还缺 {missing.length} 个值</strong>
    <p className="field-hint">这些键在 Actor 描述或成员条目里是占位（$required），成员要等它们在这一台的配置里填上才能构建。值可以写 <code>$global.名称</code> 引用全局 key。</p>
    {missing.map((row) => <div className="member-missing-row" key={row.key} data-key={row.key}>
      <div><code>{row.key}</code>{row.hint && <small>{row.hint}</small>}</div>
      <input aria-label={`填写 ${row.key}`} value={values[row.key] ?? ''} disabled={disabled || !writable || Boolean(busy)} onChange={(event) => setValues((current) => ({ ...current, [row.key]: event.target.value }))} />
      <button type="button" disabled={disabled || !writable || Boolean(busy) || !values[row.key]} onClick={() => void fill(row.key)}>{busy === row.key ? '写入中…' : '填入'}</button>
    </div>)}
    {error && <p className="governance-error" role="alert">{error}</p>}
  </div>;
}

function formatValue(value) {
  if (value === undefined) return '—';
  return typeof value === 'string' ? value : JSON.stringify(value);
}

// 成员的各层。按需读取（system.member.get 是一条账本请求，恒不自动发）：
// 描述条目（发 member.set）和这一台的配置（发 member.config.set）分两块编辑；
// 下面是合成后的值、每个键来自哪一层、还缺的占位和最近一次构建。
export function MemberConfigSection({ actor, port = {} }) {
  const commands = port.commands || {};
  const [info, setInfo] = useState(null);
  const [reading, setReading] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [editing, setEditing] = useState('');
  // 构建失败、还没在跑的成员没有 kind；它在频道描述里有条目，就能编辑。
  const editable = isEditableMemberKind(actor?.kind) || (!actor?.kind && Boolean(info) && !info.generated && plainObject(info.body));
  const readable = typeof commands.readMember === 'function';
  const actorIdRef = useRef(actor?.id);
  actorIdRef.current = actor?.id;
  useEffect(() => { setInfo(null); setEditing(''); setError(''); setNotice(''); setReading(false); }, [actor?.id]);

  // 回复回来时如果已经换了成员，它说的是上一个成员：丢掉，恒不显示在这一个下面。
  const read = async () => {
    if (!readable) return null;
    const target = actor?.id;
    setReading(true);
    setError('');
    try {
      const value = await commands.readMember(actor);
      if (actorIdRef.current !== target) return null;
      setInfo(value || {});
      return value;
    } catch (failure) {
      if (actorIdRef.current === target) setError(errorText(failure));
      return null;
    } finally {
      if (actorIdRef.current === target) setReading(false);
    }
  };

  const saved = async (message) => {
    setEditing('');
    setNotice(message);
    await read();
  };

  const described = Boolean(info) && !info.generated && plainObject(info.body);
  const sources = info ? memberSourceRows(info) : [];
  const effective = info?.effective;
  return <section className="panel-card member-config" aria-label="成员配置">
    <header className="panel-card-header">
      <h3>描述与配置</h3>
      <button type="button" className="text-button" disabled={!readable || reading || Boolean(editing)} title={editing ? '编辑中不刷新：改动以打开编辑器时读到的值为底' : undefined} onClick={() => { setNotice(''); void read(); }}>{reading ? '读取中…' : info ? '刷新' : '读取配置'}</button>
    </header>
    {!readable && <p className="governance-empty">当前会话不能读取成员配置。</p>}
    {readable && !info && !reading && !error && <p className="governance-empty">按需读取：点「读取配置」向本频道 system 发一条 system.member.get。</p>}
    {error && <p className="governance-error" role="alert">{error}</p>}
    {notice && <p className="operation-state state-completed" role="status">{notice}</p>}
    {info && <>
      <dl className="work-item-metadata member-config-facts">
        <dt>Class</dt><dd>{info.class || '—'}</dd>
        <dt>来源</dt><dd>{info.generated ? '运行时生成（不在频道描述里）' : memberBodyLabel(info.body) || '—'}</dd>
        <dt>运行设备</dt><dd>{info.desired_host || 'local-device'}</dd>
      </dl>
      {info.note && <p className="field-hint member-note" role="status">{info.note}</p>}
      {info.build && <div className="member-build" aria-label="最近一次构建"><BuildLine record={info.build} label="最近一次构建" /></div>}
      {!editing && <MissingPlaceholders actor={actor} info={info} commands={commands} disabled={port.disabled || !editable} onSaved={saved} />}
      {described && <section className="member-block" aria-label="描述条目">
        <h4>描述条目 <small>频道描述里，所有这个频道的实例共用</small></h4>
        {editing !== 'entry' && <pre className="member-config-json" aria-label="当前 params">{JSON.stringify(info.params ?? {}, null, 2)}</pre>}
        {editing !== 'entry' && Array.isArray(info.requires) && info.requires.length > 0 && <p className="field-hint">requires：{info.requires.join('、')}</p>}
        {!editing && editable && <button type="button" className="secondary-button" disabled={port.disabled || typeof commands.setMember !== 'function'} onClick={() => { setNotice(''); setEditing('entry'); }}>编辑条目</button>}
        {editing === 'entry' && <MemberEntryEditor actor={actor} info={info} commands={commands} descriptions={port.actorDescriptions} disabled={port.disabled} onCancel={() => setEditing('')} onSaved={saved} />}
      </section>}
      {described && <section className="member-block" aria-label="这一台的配置">
        <h4>这一台的配置 <small>本频道的库里，只属于这个成员</small></h4>
        {editing !== 'config' && <pre className="member-config-json" aria-label="当前配置">{JSON.stringify(info.own_config?.values ?? {}, null, 2)}</pre>}
        {editing !== 'config' && info.own_config?.revision > 0 && <p className="field-hint">第 {info.own_config.revision} 版{info.own_config.desired_host ? ` · 运行设备 ${info.own_config.desired_host}` : ''}</p>}
        {!editing && editable && <button type="button" className="secondary-button" disabled={port.disabled || typeof commands.setMemberConfig !== 'function'} onClick={() => { setNotice(''); setEditing('config'); }}>编辑配置</button>}
        {editing === 'config' && <MemberOwnConfigEditor actor={actor} info={info} commands={commands} devices={port.devices} globalKeys={port.globalKeys} disabled={port.disabled} onCancel={() => setEditing('')} onSaved={saved} />}
      </section>}
      {!editable && <p className="governance-empty">只有 Agent 和工具成员有可编辑的描述和配置。</p>}
      <section className="member-block" aria-label="合成后的值">
        <h4>合成后的值 <small>Class 默认值 ← Actor 描述 ← 成员条目 ← 这一台的配置</small></h4>
        {sources.length > 0
          ? <table className="member-sources"><thead><tr><th>键</th><th>值</th><th>来自</th></tr></thead><tbody>
            {sources.map((row) => <tr key={row.path} data-layer={row.layer}><td><code>{row.path}</code></td><td title={formatValue(row.value)}>{formatValue(row.value)}</td><td>{row.label}</td></tr>)}
          </tbody></table>
          : <pre className="member-config-json" aria-label="合成配置">{JSON.stringify(effective ?? {}, null, 2)}</pre>}
        {JSON.stringify(effective ?? {}).includes('"$global.')
          && <p className="field-hint">以 <code>$global.</code> 开头的是对 {GLOBAL_PREFIX}&lt;名称&gt; 的引用，不是值。</p>}
      </section>
    </>}
  </section>;
}
