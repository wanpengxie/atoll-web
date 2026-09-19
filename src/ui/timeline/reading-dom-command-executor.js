// The list adapter owns DOM references, while this module is the only
// capability allowed to turn typed Reading commands into geometry writes.
function writeScroll(root, top) {
  if (typeof root?.scrollTo !== 'function') return false;
  root.scrollTo({ top, behavior: 'auto' });
  return true;
}

export function executeReadingDOMCommand(command, { virtuoso, root }) {
  if (command.type === 'position-row') {
    if (typeof virtuoso?.scrollToIndex !== 'function') return false;
    virtuoso.scrollToIndex({
      index: command.index,
      align: 'start',
      ...(Number.isFinite(command.viewportOffset)
        ? { offset: -command.viewportOffset }
        : {}),
    });
    return true;
  }
  if (command.type === 'scroll-tail') {
    return writeScroll(root, command.reverse === true ? 0 : root.scrollHeight);
  }
  if (command.type === 'restore-content-anchor') {
    if (!root || !command.anchorID || !Number.isFinite(Number(command.viewportOffset))
      || !Number.isFinite(Number(command.beforeScrollHeight))
      || typeof root.querySelectorAll !== 'function') return false;
    const anchor = [...root.querySelectorAll('[data-fold-id]')]
      .find((node) => node.getAttribute('data-fold-id') === String(command.anchorID));
    if (!anchor) return false;
    if (command.expectedExpanded != null
      && anchor.getAttribute('aria-expanded') !== String(Boolean(command.expectedExpanded))) return false;
    const currentHeight = Number(root.scrollHeight);
    if (!Number.isFinite(currentHeight)
      || Math.abs(currentHeight - Number(command.beforeScrollHeight)) <= 0.5) return false;
    const rootRect = root.getBoundingClientRect?.();
    const anchorRect = anchor.getBoundingClientRect?.();
    if (!rootRect || !anchorRect || !Number.isFinite(rootRect.top) || !Number.isFinite(anchorRect.top)) return false;
    const delta = (anchorRect.top - rootRect.top) - Number(command.viewportOffset);
    if (Math.abs(delta) <= 0.5) return true;
    const currentTop = Number(root.scrollTop || 0);
    const maxTop = Math.max(0, currentHeight - Number(root.clientHeight || 0));
    const targetTop = Math.min(maxTop, Math.max(0, currentTop + delta));
    if (Math.abs(targetTop - currentTop) <= 0.5) return true;
    return writeScroll(root, targetTop);
  }
  if (command.type === 'claim-focus') {
    root?.focus?.({ preventScroll: true });
    return true;
  }
  return false;
}
