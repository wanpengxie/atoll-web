export const READING_OWNER_SELECTOR = [
  // During an atomic Following -> browsing handoff, the outgoing Following
  // surface remains the only interactive paint. The incoming virtualizer is
  // mounted inert and must not be sampled yet.
  '.timeline-reading-stack[data-handoff-pending="true"] > .timeline-reading-layer.is-outgoing > .timeline-message-list',
  // Once the handoff is no longer pending, prefer the incoming browsing
  // owner. This deliberately excludes a stale outgoing layer if React and the
  // browser expose both layers at the commit boundary.
  '.timeline-reading-stack:not([data-handoff-pending="true"]) > .timeline-reading-layer.is-incoming.is-active > .timeline-message-list',
  // Ordinary Following mode has no incoming layer.
  '.timeline-reading-stack:not([data-handoff-pending="true"]) > .timeline-reading-layer.is-active:not(.is-incoming) > .timeline-message-list',
].join(', ');

export function readingOwnerNodes(root = document) {
  return [...root.querySelectorAll(READING_OWNER_SELECTOR)];
}

export function currentReadingOwner(root = document) {
  const owners = readingOwnerNodes(root);
  if (owners.length !== 1) {
    throw new Error(`expected exactly one current reading owner, found ${owners.length}`);
  }
  return owners[0];
}

export function tailDistance(node) {
  if (!node) return Number.POSITIVE_INFINITY;
  return node.dataset?.readingContainer === 'following-tail'
    ? Math.abs(Number(node.scrollTop || 0))
    : Math.max(0, Number(node.scrollHeight || 0) - Number(node.clientHeight || 0) - Number(node.scrollTop || 0));
}

export function readingOwner(page) {
  return page.locator(READING_OWNER_SELECTOR);
}

export async function installReadingOwnerHelper(page) {
  await page.addInitScript(({ selector }) => {
    const nodes = () => [...document.querySelectorAll(selector)];
    const current = () => {
      const owners = nodes();
      if (owners.length !== 1) {
        throw new Error(`expected exactly one current reading owner, found ${owners.length}`);
      }
      return owners[0];
    };
    const distance = (node = current()) => (
      node.dataset?.readingContainer === 'following-tail'
        ? Math.abs(Number(node.scrollTop || 0))
        : Math.max(0, Number(node.scrollHeight || 0) - Number(node.clientHeight || 0) - Number(node.scrollTop || 0))
    );
    Object.defineProperty(window, '__ATOLL_TEST_READING_OWNER__', {
      configurable: true,
      value: Object.freeze({ current, nodes, tailDistance: distance }),
    });
  }, { selector: READING_OWNER_SELECTOR });
}
