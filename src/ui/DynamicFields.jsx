import React from 'react';
import { SelectMenu } from './primitives/SelectMenu.jsx';

export function initialFieldValues(spec) {
  return Object.fromEntries(spec.fields.map((field) => [
    field.name,
    spec.initial?.[field.name] ?? (field.type === 'boolean' ? false : ''),
  ]));
}

function DynamicFieldInput({ field, value, onChange }) {
  if (field.enum) {
    return <SelectMenu
      ariaLabel={field.name}
      value={value ?? ''}
      placeholder="请选择"
      options={field.enum.map((item) => ({ value: String(item), label: String(item) }))}
      onChange={onChange}
    />;
  }
  if (field.type === 'boolean') {
    return <input type="checkbox" checked={Boolean(value)} onChange={(event) => onChange(event.target.checked)} />;
  }
  if (field.type === 'object' || field.type === 'array' || field.multiline) {
    return <textarea rows={field.type === 'string' ? 3 : 5} value={value ?? ''} onChange={(event) => onChange(event.target.value)} placeholder={field.type === 'string' ? '' : field.type === 'array' ? '[]' : '{}'} />;
  }
  return <input type={field.type === 'number' || field.type === 'integer' ? 'number' : 'text'} step={field.type === 'integer' ? '1' : 'any'} value={value ?? ''} onChange={(event) => onChange(event.target.value)} />;
}

export function DynamicFields({ spec, values, onChange, className }) {
  return <div className={className}>{spec.fields.map((field) => <label key={field.name}>
    <span>{field.name}{field.required && <em>必填</em>}</span>
    {field.description && <small>{field.description}</small>}
    <DynamicFieldInput field={field} value={values[field.name]} onChange={(value) => onChange(field.name, value)} />
  </label>)}
  {!spec.fields.length && <p className="empty-parameters">此操作不需要参数。</p>}
  </div>;
}
