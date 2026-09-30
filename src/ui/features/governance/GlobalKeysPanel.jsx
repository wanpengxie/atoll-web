import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { GLOBAL_NAME_HINT, GLOBAL_PREFIX, GLOBAL_REFERENCE_PREFIX } from '../../../model/global-keys.js';
import { initialFormValues, schemaFields, validateFormValues } from '../../../model/json-schema-form.js';
import { InlineConfirmation } from '../../primitives/InlineConfirmation.jsx';
import { JsonSchemaForm } from '../../primitives/JsonSchemaForm.jsx';
import { PanelCard } from '../../primitives/PanelCard.jsx';

const ADD_SCHEMA = Object.freeze({
  type: 'object',
  required: ['name', 'value'],
  properties: {
    name: { type: 'string', title: '名称', description: `存为 ${GLOBAL_PREFIX}<名称>；${GLOBAL_NAME_HINT}。`, pattern: '^[a-z0-9_-]{1,64}$', examples: ['deepseek_prod'] },
    value: { type: 'string', title: '值', description: '之后可以整值覆盖。' },
  },
});

const WRITE_SCHEMA = Object.freeze({
  type: 'object',
  required: ['value'],
  properties: {
    value: { type: 'string', title: '新值', description: '覆盖原值。' },
  },
});

function errorText(error) {
  const detail = error?.detail || error?.message || String(error);
  return error?.code && !String(detail).includes(error.code) ? `${error.code}：${detail}` : detail;
}

function ChangeValueForm({ name, disabled, onSubmit, onCancel }) {
  const fields = useMemo(() => schemaFields(WRITE_SCHEMA, { secret: ['value'] }), []);
  const [values, setValues] = useState(() => initialFormValues(fields));
  const [errors, setErrors] = useState({});
  const submit = async (event) => {
    event.preventDefault();
    const checked = validateFormValues(fields, values);
    setErrors(checked.errors);
    if (!checked.valid) return;
    // 值只在这一次提交里经过；成功后清掉，不在组件里多留一刻。
    if (await onSubmit(checked.values.value)) setValues(initialFormValues(fields));
  };
  return <form className="global-key-change" aria-label={`修改 ${name} 的值`} onSubmit={submit}>
    <JsonSchemaForm fields={fields} values={values} errors={errors} disabled={disabled} idPrefix={`global-key-${name}`} onChange={(field, value) => setValues((current) => ({ ...current, [field]: value }))} />
    <div className="form-actions">
      <button type="button" disabled={disabled} onClick={onCancel}>取消</button>
      <button type="submit" className="primary-button" disabled={disabled}>保存新值</button>
    </div>
  </form>;
}

// 空间管理 → 全局 key。列名字和原值（开发期前端不打码，owner 10-01"现在先显示
// 全部，我需要调试"），可以添加、整值覆盖、删除。读写都经当前频道的资源面
// （global/ 前缀在每个频道都指向同一份）。
export function GlobalKeysPanel({ port = {} }) {
  const commands = port.commands || {};
  const available = port.available === true;
  const [names, setNames] = useState(null);
  const [values, setValues] = useState({});
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [editing, setEditing] = useState('');
  const [confirm, setConfirm] = useState('');
  const addFields = useMemo(() => schemaFields(ADD_SCHEMA, { secret: ['value'] }), []);
  const [addValues, setAddValues] = useState(() => initialFormValues(addFields));
  const [addErrors, setAddErrors] = useState({});
  const listRequestRef = useRef(0);

  const refresh = useCallback(async () => {
    if (!available || typeof commands.list !== 'function') return;
    const request = ++listRequestRef.current;
    setBusy((current) => current || 'list');
    setError('');
    try {
      const next = await commands.list();
      if (request !== listRequestRef.current) return;
      const listed = Array.isArray(next) ? next : [];
      setNames(listed);
      if (typeof commands.read === 'function') {
        const read = await Promise.all(listed.map(async (name) => {
          try {
            const value = await commands.read(name);
            return [name, value?.exists ? value.value : ''];
          } catch (failure) {
            return [name, `（读不到：${errorText(failure)}）`];
          }
        }));
        if (request === listRequestRef.current) setValues(Object.fromEntries(read));
      }
    } catch (failure) {
      if (request === listRequestRef.current) setError(errorText(failure));
    } finally {
      if (request === listRequestRef.current) setBusy((current) => current === 'list' ? '' : current);
    }
  }, [available, commands.list, commands.read]);

  // 打开这个标签页就是读名单的动作，只读这一次。全局 key 全空间一份，换频道
  // 不重读；重连也不自己再读（前端恒不自动探测）：要读就点刷新。
  const refreshRef = useRef(refresh);
  refreshRef.current = refresh;
  const readOnceRef = useRef(false);
  useEffect(() => {
    if (!available || readOnceRef.current) return;
    readOnceRef.current = true;
    void refreshRef.current();
  }, [available]);

  const run = async (label, operation, success) => {
    setBusy(label);
    setError('');
    setNotice('');
    try {
      await operation();
      setNotice(success);
      await refresh();
      return true;
    } catch (failure) {
      setError(errorText(failure));
      return false;
    } finally {
      setBusy('');
    }
  };

  const add = async (event) => {
    event.preventDefault();
    const checked = validateFormValues(addFields, addValues);
    setAddErrors(checked.errors);
    if (!checked.valid) return;
    const { name, value } = checked.values;
    const done = await run('add', () => commands.create(name, value), `已添加 ${GLOBAL_PREFIX}${name}。`);
    if (done) setAddValues(initialFormValues(addFields));
  };

  const disabled = !available || Boolean(busy) || port.disabled === true;
  return <>
    {!available && <p className="governance-error" role="status">{port.reason || '当前没有可用的资源面；全局 key 需要经一个你是成员的频道读写。'}</p>}
    {error && <p className="governance-error" role="alert">{error}</p>}
    {notice && <p className="operation-state state-completed" role="status">{notice}</p>}
    <PanelCard
      className="global-keys"
      title="全局 key"
      titleMeta={names ? String(names.length) : ''}
      action={<button type="button" className="text-button" disabled={!available || Boolean(busy)} onClick={() => void refresh()}>{busy === 'list' ? '读取中…' : '刷新'}</button>}
    >
      <p className="governance-empty">整个空间共用一份。成员配置里写 <code>"{GLOBAL_REFERENCE_PREFIX}&lt;名称&gt;"</code> 引用它。</p>
      {names?.map((name) => <div className="global-key-row" key={name} data-global-key={name}>
        <div className="global-key-summary">
          <div><strong>{name}</strong><small><code>{GLOBAL_REFERENCE_PREFIX}{name}</code></small>{Object.hasOwn(values, name) && <code className="global-key-value" data-global-key-value={name}>{values[name]}</code>}</div>
          <div className="global-key-actions">
            <button type="button" disabled={disabled} aria-label={`修改 ${name} 的值`} onClick={() => { setConfirm(''); setEditing(editing === name ? '' : name); }}>修改值</button>
            <button type="button" className="danger-text" disabled={disabled} aria-label={`删除 ${name}`} onClick={() => { setEditing(''); setConfirm(name); }}>删除</button>
          </div>
        </div>
        {editing === name && <ChangeValueForm
          name={name}
          disabled={disabled}
          onCancel={() => setEditing('')}
          onSubmit={async (value) => {
            const done = await run('write', () => commands.write(name, value), `已覆盖 ${GLOBAL_PREFIX}${name} 的值。`);
            if (done) setEditing('');
            return done;
          }}
        />}
        {confirm === name && <InlineConfirmation
          title={`删除 ${GLOBAL_PREFIX}${name}？`}
          description="引用它的成员配置会在下次构建时因缺少这个 key 而卡住。"
          tone="danger"
          confirmLabel="删除"
          busy={Boolean(busy)}
          onCancel={() => setConfirm('')}
          onConfirm={async () => {
            const done = await run('delete', () => commands.remove(name), `已删除 ${GLOBAL_PREFIX}${name}。`);
            if (done) setConfirm('');
          }}
        />}
      </div>)}
      {names && !names.length && <p className="governance-empty">还没有全局 key。</p>}
      {!names && available && busy === 'list' && <p className="governance-empty">正在读取全局 key…</p>}
    </PanelCard>
    <PanelCard as="form" className="governance-form global-key-add" title="添加全局 key" aria-label="添加全局 key" onSubmit={add}>
      <JsonSchemaForm fields={addFields} values={addValues} errors={addErrors} disabled={disabled} idPrefix="global-key-add" onChange={(field, value) => setAddValues((current) => ({ ...current, [field]: value }))} />
      <button type="submit" className="primary-button" disabled={disabled}>{busy === 'add' ? '正在添加…' : '添加'}</button>
    </PanelCard>
  </>;
}
