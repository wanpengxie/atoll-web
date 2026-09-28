import React, { useRef, useState } from 'react';
import { initialFormValues, validateFormValues } from '../model/json-schema-form.js';
import { JsonSchemaForm } from './primitives/JsonSchemaForm.jsx';
import { useModalFocus } from './primitives/useModalFocus.js';

function errorText(error) {
  return error?.detail || error?.message || String(error);
}

// ui.form 的弹窗：频道里某个 actor 请这块屏填一张表。表单从请求里的 JSON Schema
// 画出来；secret 字段是密码框，提交时由客户端自己写进对应的 global/<name>，回复
// 里只有掩码。写失败时表单留着，人可以重试或取消；取消回的是 cancelled。
export function UiFormModal({ form, requesterName = '', channelName = '', onSubmit, onCancel }) {
  const dialogRef = useRef(null);
  const [values, setValues] = useState(() => initialFormValues(form.fields, form.values));
  const [errors, setErrors] = useState({});
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const secretFields = form.fields.filter((field) => field.secret);

  const cancel = async () => {
    if (busy) return;
    setBusy('cancel');
    setError('');
    try {
      await onCancel?.(form);
    } catch (failure) {
      setError(errorText(failure));
      setBusy('');
    }
  };

  useModalFocus({ dialogRef, onClose: () => { void cancel(); }, closeDisabled: Boolean(busy) });

  const submit = async (event) => {
    event.preventDefault();
    if (busy) return;
    const checked = validateFormValues(form.fields, values);
    setErrors(checked.errors);
    if (!checked.valid) return;
    setBusy('submit');
    setError('');
    try {
      await onSubmit?.(form, checked.values);
    } catch (failure) {
      setError(errorText(failure));
      setBusy('');
    }
  };

  const titleId = `ui-form-title-${form.id}`;
  return <div className="modal-backdrop ui-form-backdrop" data-modal-layer role="presentation">
    <section ref={dialogRef} tabIndex={-1} className="task-create-modal ui-form-modal" role="dialog" aria-modal="true" aria-labelledby={titleId}>
      <header>
        <div><p className="eyebrow">UI FORM</p><h2 id={titleId}>{form.title}</h2></div>
        <button type="button" onClick={() => void cancel()} disabled={Boolean(busy)} aria-label="取消表单">×</button>
      </header>
      <form className="ui-form" onSubmit={submit} noValidate>
        <p className="ui-form-origin">{requesterName || form.requester || '频道成员'} 请你在这块屏上填写{channelName ? ` · ${channelName}` : ''}</p>
        <JsonSchemaForm
          fields={form.fields}
          values={values}
          errors={errors}
          disabled={Boolean(busy)}
          idPrefix={`ui-form-${String(form.id).replace(/[^a-zA-Z0-9_-]/g, '')}`}
          ariaLabel={form.title}
          onChange={(name, value) => setValues((current) => ({ ...current, [name]: value }))}
        />
        {secretFields.length > 0 && <ul className="ui-form-secrets" aria-label="密钥去向">
          {secretFields.map((field) => <li key={field.name}><strong>{field.label}</strong> 只写入全局 key <code>{form.secret[field.name]}</code>，回复里只有掩码。</li>)}
        </ul>}
        {error && <p className="governance-error" role="alert">{error}</p>}
        <footer>
          <button type="button" onClick={() => void cancel()} disabled={Boolean(busy)}>{busy === 'cancel' ? '正在取消…' : '取消'}</button>
          <button type="submit" className="primary-button" disabled={Boolean(busy)}>{busy === 'submit' ? '正在提交…' : '提交'}</button>
        </footer>
      </form>
    </section>
  </div>;
}
