const STACK_LIMIT = 20;

function sameFile(left, right) {
  return left?.channelId === right?.channelId
    && left?.resourceId === right?.resourceId
    && Number(left?.line || 0) === Number(right?.line || 0);
}

export function pushFilePreview(stack, artifact, fallback = null) {
  if (!artifact?.channelId || !artifact?.resourceId) return Array.isArray(stack) ? stack : [];
  const current = Array.isArray(stack) ? stack : [];
  const base = current.length ? current : fallback ? [fallback] : [];
  if (sameFile(base.at(-1), artifact)) return [...base.slice(0, -1), artifact];
  return [...base, artifact].slice(-STACK_LIMIT);
}

export function popFilePreview(stack) {
  return Array.isArray(stack) && stack.length > 1 ? stack.slice(0, -1) : [];
}
