/**
 * @typedef {Readonly<{
 *   channelId: string,
 *   messageId: string,
 * }>} SubmissionIdentity
 */

/**
 * The Composer-owned correlation surface used by a feed consumer to decide
 * whether a request belongs to this principal's durable submission ledger.
 *
 * `pending` and `landed` are read-only snapshots. The port itself is stable
 * for the lifetime of one Composer submission runtime, while its snapshots
 * reflect the current mutable ledger at read time.
 *
 * @typedef {Object} SubmissionCorrelationPort
 * @property {readonly SubmissionIdentity[]} pending
 * @property {readonly SubmissionIdentity[]} landed
 * @property {(identity: SubmissionIdentity) => boolean} record
 * @property {(identity: SubmissionIdentity) => boolean} markLanded
 * @property {(identity: SubmissionIdentity) => boolean} owns
 * @property {(identity: SubmissionIdentity) => boolean} forget
 * @property {() => void} reset
 */

function normalizeIdentity(identity) {
  if (!identity || typeof identity !== 'object') return null;
  const { channelId, messageId } = identity;
  if (typeof channelId !== 'string' || !channelId
    || typeof messageId !== 'string' || !messageId) return null;
  return Object.freeze({ channelId, messageId });
}

function identityKey(identity) {
  return JSON.stringify([identity.channelId, identity.messageId]);
}

function snapshot(store) {
  return Object.freeze([...store.values()]);
}

/**
 * Create the stable, Composer-owned submission correlation port.
 *
 * @returns {SubmissionCorrelationPort}
 */
export function createSubmissionCorrelationPort() {
  const pending = new Map();
  const landed = new Map();

  const record = (identity) => {
    const value = normalizeIdentity(identity);
    if (!value) return false;
    const key = identityKey(value);
    // A feed fact wins over a later retry of the same durable id. Keeping it
    // in landed prevents a duplicate request from being treated as pending.
    if (landed.has(key)) return true;
    pending.set(key, value);
    return true;
  };

  const markLanded = (identity) => {
    const value = normalizeIdentity(identity);
    if (!value) return false;
    const key = identityKey(value);
    pending.delete(key);
    landed.set(key, value);
    return true;
  };

  const owns = (identity) => {
    const value = normalizeIdentity(identity);
    if (!value) return false;
    const key = identityKey(value);
    return pending.has(key) || landed.has(key);
  };

  const forget = (identity) => {
    const value = normalizeIdentity(identity);
    if (!value) return false;
    const key = identityKey(value);
    const removed = pending.delete(key) || landed.delete(key);
    // Delete from both maps even when the first delete succeeded. This keeps
    // the invariant explicit if a future transition stores the same key in
    // both phases.
    pending.delete(key);
    landed.delete(key);
    return removed;
  };

  const reset = () => {
    pending.clear();
    landed.clear();
  };

  const port = { record, markLanded, owns, forget, reset };
  Object.defineProperties(port, {
    pending: {
      enumerable: true,
      get: () => snapshot(pending),
    },
    landed: {
      enumerable: true,
      get: () => snapshot(landed),
    },
  });
  return Object.freeze(port);
}
