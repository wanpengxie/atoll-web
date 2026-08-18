import React, { cloneElement, isValidElement, useId } from 'react';

export function FormField({ label, description, error, required = false, className = '', children }) {
  const generatedId = useId();
  const controlId = isValidElement(children) && children.props.id ? children.props.id : generatedId;
  const descriptionId = description ? `${generatedId}-description` : undefined;
  const errorId = error ? `${generatedId}-error` : undefined;
  const describedBy = [descriptionId, errorId].filter(Boolean).join(' ') || undefined;
  const control = isValidElement(children) ? cloneElement(children, {
    id: controlId,
    'aria-describedby': [children.props['aria-describedby'], describedBy].filter(Boolean).join(' ') || undefined,
    'aria-invalid': error ? true : children.props['aria-invalid'],
  }) : children;

  return <div className={`form-field ${error ? 'form-field-error' : ''} ${className}`.trim()}>
    <label htmlFor={controlId}>{label}{required && <em aria-hidden="true">必填</em>}</label>
    {description && <small id={descriptionId}>{description}</small>}
    {control}
    {error && <p id={errorId} role="alert">{error}</p>}
  </div>;
}
