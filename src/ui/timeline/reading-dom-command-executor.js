// The list adapter owns DOM references, while this module is the only
// capability allowed to turn typed Reading commands into geometry writes.
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
    if (typeof root?.scrollTo !== 'function') return false;
    root.dispatchEvent(new CustomEvent('atoll:timeline-bottom-write', { bubbles: true }));
    root.scrollTo({ top: command.reverse === true ? 0 : root.scrollHeight, behavior: 'auto' });
    return true;
  }
  if (command.type === 'claim-focus') {
    root?.focus?.({ preventScroll: true });
    return true;
  }
  return false;
}
