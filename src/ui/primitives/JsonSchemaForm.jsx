import React, { useId } from 'react';
import { enumOptionValue } from '../../model/json-schema-form.js';

// 按 schemaFields() 的字段表画一组受控输入。值、校验、提交都在调用方：这里只负责
// "每个字段长什么样"。secret 字段恒是密码框，而且不带任何回显。
export function JsonSchemaForm({ fields = [], values = {}, errors = {}, onChange, disabled = false, idPrefix = '', ariaLabel }) {
  const generated = useId();
  const prefix = idPrefix || `schema-form${generated.replace(/:/g, '')}`;
  const change = (name, value) => onChange?.(name, value);
  return <div className="schema-form" role="group" aria-label={ariaLabel}>
    {fields.map((field) => {
      const id = `${prefix}-${field.name}`;
      const error = errors?.[field.name] || '';
      const hintId = field.description ? `${id}-hint` : undefined;
      const errorId = error ? `${id}-error` : undefined;
      const common = {
        id,
        name: field.name,
        disabled,
        'aria-invalid': error ? true : undefined,
        'aria-required': field.required || undefined,
        'aria-describedby': [hintId, errorId].filter(Boolean).join(' ') || undefined,
      };
      const value = values?.[field.name];
      const placeholder = field.examples?.length && ['text', 'password', 'number'].includes(field.control)
        ? `例如 ${String(field.examples[0])}`
        : undefined;
      let control;
      if (field.control === 'checkbox') {
        control = <input type="checkbox" {...common} checked={value === true} onChange={(event) => change(field.name, event.target.checked)} />;
      } else if (field.control === 'select') {
        control = <select {...common} value={typeof value === 'string' ? value : ''} onChange={(event) => change(field.name, event.target.value)}>
          <option value="">请选择</option>
          {(field.enum || []).map((option) => <option key={enumOptionValue(option)} value={enumOptionValue(option)}>{String(option)}</option>)}
        </select>;
      } else if (field.control === 'json') {
        control = <textarea {...common} rows="4" spellCheck={false} value={typeof value === 'string' ? value : ''} onChange={(event) => change(field.name, event.target.value)} />;
      } else {
        control = <input
          {...common}
          type={field.control === 'password' ? 'password' : field.control === 'number' ? 'number' : 'text'}
          step={field.control === 'number' ? (field.type === 'integer' ? '1' : 'any') : undefined}
          autoComplete={field.control === 'password' ? 'new-password' : 'off'}
          spellCheck={field.control === 'password' ? false : undefined}
          placeholder={placeholder}
          value={typeof value === 'string' ? value : ''}
          onChange={(event) => change(field.name, event.target.value)}
        />;
      }
      return <div className={`schema-field control-${field.control}`} key={field.name} data-field={field.name}>
        {/* 必填星号放在 label 外：label 的文字就是字段名，必填由 aria-required 说。 */}
        <div className="schema-field-head"><label htmlFor={id}>{field.label}</label>{field.required && <span className="schema-required" aria-hidden="true">*</span>}</div>
        {control}
        {field.description && <small id={hintId} className="schema-hint">{field.description}</small>}
        {error && <small id={errorId} className="schema-error" role="alert">{error}</small>}
      </div>;
    })}
  </div>;
}
