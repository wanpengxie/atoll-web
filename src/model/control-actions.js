function normalizedError(error) {
  if (!error) return null;
  return {
    code: error.code || 'unknown',
    detail: error.detail || error.message || String(error),
  };
}

export function createControlState(status, error = null, now = Date.now()) {
  return {
    status,
    error: normalizedError(error),
    updatedAt: now,
  };
}
