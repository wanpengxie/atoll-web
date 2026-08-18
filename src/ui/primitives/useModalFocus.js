import { useEffect, useLayoutEffect, useRef } from 'react';

const FOCUSABLE = [
  'button:not([disabled])',
  'input:not([disabled])',
  'textarea:not([disabled])',
  'select:not([disabled])',
  'a[href]',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

function visibleFocusable(container) {
  return [...(container?.querySelectorAll(FOCUSABLE) || [])]
    .filter((node) => !node.hidden && node.getAttribute('aria-hidden') !== 'true');
}

/**
 * Modal accessibility contract shared by all app-level dialogs:
 * - move focus into the dialog and keep Tab inside it;
 * - Escape closes when the current operation permits it;
 * - make sibling application surfaces inert while the dialog is open;
 * - restore the opener on unmount.
 */
export function useModalFocus({ dialogRef, initialFocusRef, returnFocusRef, onClose, closeDisabled = false }) {
  const openerRef = useRef(null);
  const onCloseRef = useRef(onClose);
  const closeDisabledRef = useRef(closeDisabled);

  useLayoutEffect(() => { onCloseRef.current = onClose; }, [onClose]);
  useLayoutEffect(() => { closeDisabledRef.current = closeDisabled; }, [closeDisabled]);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return undefined;
    openerRef.current = returnFocusRef?.current || document.activeElement;

    const layer = dialog.closest('[data-modal-layer]');
    const root = layer?.parentElement;
    const siblings = root ? [...root.children].filter((node) => node !== layer) : [];
    const siblingState = siblings.map((node) => ({
      node,
      inert: Boolean(node.inert),
      ariaHidden: node.getAttribute('aria-hidden'),
    }));
    for (const node of siblings) {
      node.inert = true;
      node.setAttribute('aria-hidden', 'true');
    }

    const initial = initialFocusRef?.current || visibleFocusable(dialog)[0] || dialog;
    initial.focus();

    function onKeyDown(event) {
      if (event.key === 'Escape') {
        if (!closeDisabledRef.current) {
          event.preventDefault();
          onCloseRef.current?.();
        }
        return;
      }
      if (event.key !== 'Tab') return;
      const focusable = visibleFocusable(dialog);
      if (!focusable.length) {
        event.preventDefault();
        dialog.focus();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && (document.activeElement === first || !dialog.contains(document.activeElement))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (document.activeElement === last || !dialog.contains(document.activeElement))) {
        event.preventDefault();
        first.focus();
      }
    }

    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      for (const { node, inert, ariaHidden } of siblingState) {
        node.inert = inert;
        if (ariaHidden === null) node.removeAttribute('aria-hidden');
        else node.setAttribute('aria-hidden', ariaHidden);
      }
      const opener = returnFocusRef?.current || openerRef.current;
      if (opener?.isConnected && !opener.disabled) opener.focus();
    };
  }, [dialogRef, initialFocusRef, returnFocusRef]);
}
