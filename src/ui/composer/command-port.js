const COMMAND_NAMES = Object.freeze([
  'changeDraft',
  'addMention',
  'pickMention',
  'removeMention',
  'clearReply',
  'send',
  'executeCommand',
  'steer',
  'replace',
  'interrupt',
  'retry',
  'edit',
  'cancelEdit',
  'attach',
  'upload',
  'removeAttachment',
  'clearAttachments',
  'selectAgent',
  'openAgentSelector',
  'setModelParameters',
]);

function retiredResult(name) {
  const error = new Error(`Composer command port 已退休：${name}`);
  error.code = 'composer_owner_retired';
  return Promise.reject(error);
}

// One port belongs to one mounted channel owner. React render candidates may
// prepare a replacement, but only layout commit publishes it here. Cleanup is
// lease-scoped so StrictMode/stale cleanup cannot retire a newer commit.
export function createComposerCommandPort() {
  let committed = null;
  let lease = 0;
  let retired = false;

  const commands = Object.freeze(Object.fromEntries(COMMAND_NAMES.map((name) => [name, (...args) => {
    const operation = committed?.[name];
    if (retired || typeof operation !== 'function') return retiredResult(name);
    try {
      return Promise.resolve(operation(...args));
    } catch (error) {
      return Promise.reject(error);
    }
  }])));

  return Object.freeze({
    commands,
    commit(owner) {
      if (retired) return () => {};
      lease += 1;
      const selectedLease = lease;
      committed = owner;
      return () => {
        if (lease !== selectedLease) return false;
        committed = null;
        return true;
      };
    },
    retire() {
      retired = true;
      lease += 1;
      committed = null;
    },
    current: () => committed,
  });
}

export { COMMAND_NAMES as COMPOSER_COMMAND_NAMES };
