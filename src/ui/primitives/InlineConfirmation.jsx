import React, { useEffect, useId, useRef } from 'react';

export function InlineConfirmation({ title, description, tone = 'normal', confirmLabel = '确认操作', cancelLabel = '取消', busy = false, onConfirm, onCancel, returnFocusRef }) {
  const titleId = useId();
  const cancelRef = useRef(null);
  const stateRef = useRef({ busy, onCancel });
  stateRef.current = { busy, onCancel };

  useEffect(() => {
    cancelRef.current?.focus();
    const closeOnEscape = (event) => {
      if (event.key === 'Escape' && !stateRef.current.busy) stateRef.current.onCancel();
    };
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      document.removeEventListener('keydown', closeOnEscape);
      returnFocusRef?.current?.focus();
    };
  }, [returnFocusRef]);

  return <section className={`inline-confirmation confirmation-${tone}`} aria-labelledby={titleId}>
    <h3 id={titleId}>{title}</h3>
    {description && <p>{description}</p>}
    <div className="inline-confirmation-actions">
      <button type="button" disabled={busy} ref={cancelRef} onClick={onCancel}>{cancelLabel}</button>
      <button type="button" disabled={busy} className={tone === 'danger' ? 'danger-button' : 'primary-button'} onClick={onConfirm}>{confirmLabel}</button>
    </div>
  </section>;
}
