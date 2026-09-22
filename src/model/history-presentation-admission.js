import { presentationEntryId } from './conversation-presentation.js';

const MAX_DEMAND_UNITS = 24;

function idOf(item) {
  return presentationEntryId(item);
}

function boundedDemand(value) {
  return Math.max(1, Math.min(MAX_DEMAND_UNITS, Number(value) || 1));
}

function completeConversationUnits(items) {
  return items.filter((item) => item?.kind !== 'narration').length;
}

function frozenToken(token, extra = {}) {
  return Object.freeze({ ...token, ...extra });
}

export function createHistoryPresentationAdmission({ onChange = () => {} } = {}) {
  const channels = new Map();
  let nextAuthorityRevision = 1;

  function advanceAuthority(state) {
    state.authorityRevision = nextAuthorityRevision;
    nextAuthorityRevision += 1;
  }

  function reset(channelId) {
    channels.delete(channelId);
  }

  function begin(channelId, token, baselineItems = []) {
    const existing = channels.get(channelId);
    const viewID = String(token?.viewID || '');
    const epoch = String(token?.epoch || '');
    const canInherit = existing
      && existing.phase === 'holding'
      && existing.viewID === viewID
      && existing.epoch === epoch
      && existing.token.activationID === token?.activationID;
    const durableBaselineIDs = canInherit
      ? existing.durableBaselineIDs
      : Object.freeze((token?.durableBaselineIDs || token?.baselineIDs || baselineItems.map(idOf)).filter(Boolean));
    const uiBaselineIDs = canInherit
      ? existing.uiBaselineIDs
      : Object.freeze((token?.uiBaselineIDs || token?.baselineIDs || baselineItems.map(idOf)).filter(Boolean));
    const state = {
      channelId,
      phase: 'pending',
      viewID,
      epoch,
      durableBaselineIDs,
      uiBaselineIDs,
      token: frozenToken(token, { demandUnits: boundedDemand(token?.demandUnits) }),
      stagedIDs: canInherit ? existing.stagedIDs : Object.freeze([]),
      completeUnits: canInherit ? existing.completeUnits : 0,
      candidateSourceRevision: canInherit ? existing.candidateSourceRevision : 0,
      lastAdmittedIDs: canInherit
        ? existing.lastAdmittedIDs
        : Object.freeze(baselineItems.map(idOf).filter(Boolean)),
      releaseBaselineItems: Object.freeze([]),
      releaseSourceRevision: canInherit ? Number(existing.releaseSourceRevision || 0) : 0,
      sourceFenceActive: canInherit ? existing.sourceFenceActive === true : false,
      deferredIDs: Object.freeze([]),
      committed: null,
      authorityRevision: nextAuthorityRevision,
    };
    nextAuthorityRevision += 1;
    channels.set(channelId, state);
    onChange(channelId);
    return state.token;
  }

  function orderedBoundary(ids, baselineIDs, start = -1) {
    let cursor = start;
    let first = -1;
    for (const baselineID of baselineIDs) {
      cursor = ids.indexOf(baselineID, cursor + 1);
      if (cursor < 0) return null;
      if (first < 0) first = cursor;
    }
    return { first, last: cursor };
  }

  function lastAdmitted(state, items) {
    const visible = new Set(state.lastAdmittedIDs);
    return Object.freeze(items.filter((item) => visible.has(idOf(item))));
  }

  function evaluated(state, items, mutation = {}) {
    const admittedItems = Object.freeze([...items]);
    return Object.freeze({
      items: admittedItems,
      receipt: Object.freeze({
        state,
        authorityRevision: state.authorityRevision,
        phase: state.phase,
        viewID: state.viewID,
        epoch: state.epoch,
        admittedIDs: Object.freeze(admittedItems.map(idOf).filter(Boolean)),
        ...mutation,
      }),
    });
  }

  // Feed observes only durable projected entries. It never publishes UI
  // objects and therefore cannot lose or synthesize local echo rows.
  function observeCandidate(state, items, meta = {}) {
    const ids = items.map(idOf);
    let stagedItems;
    if (!state.durableBaselineIDs.length) {
      stagedItems = items.filter((item) => Boolean(idOf(item)));
    } else {
      const boundary = orderedBoundary(ids, state.durableBaselineIDs);
      if (!boundary) return {
        stagedIDs: state.stagedIDs,
        completeUnits: state.completeUnits,
        fulfilled: false,
        rebased: true,
      };
      stagedItems = items.slice(0, boundary.first).filter((item) => Boolean(idOf(item)));
    }
    state.stagedIDs = Object.freeze(stagedItems.map(idOf));
    state.completeUnits = completeConversationUnits(stagedItems);
    state.candidateSourceRevision = Number(meta.sourceRevision || 0);
    advanceAuthority(state);
    return {
      stagedIDs: state.stagedIDs,
      completeUnits: state.completeUnits,
      fulfilled: state.completeUnits >= state.token.demandUnits,
    };
  }

  // UI admission always reconstructs from the current raw UI items. State
  // retains identities only, never durable-feed entry objects.
  // Admission withholds exactly one thing: older rows a history reveal has
  // not released yet. Everything from the oldest row the reader already has
  // onward is the reader's timeline — new live rows, rows whose identity
  // changed (a local echo replaced by its canonical row, a turn that moved
  // into the waiting dock) — and is never held back. A broken baseline order
  // only retires the reveal transaction; it must not freeze the tail.
  function firstKnownIndex(state, ids) {
    const known = new Set([...state.lastAdmittedIDs, ...state.uiBaselineIDs]);
    return ids.findIndex((id) => known.has(id));
  }

  function evaluatePending(state, items) {
    if (!state.uiBaselineIDs.length) return evaluated(state, []);
    const ids = items.map(idOf);
    const boundary = orderedBoundary(ids, state.uiBaselineIDs);
    if (!boundary) {
      const first = firstKnownIndex(state, ids);
      return evaluated(state, first < 0 ? items : items.slice(first), {
        nextPhase: 'holding',
        clearCommitted: true,
      });
    }
    return evaluated(state, items.slice(boundary.first));
  }

  function evaluateCommitted(state, items) {
    const ids = items.map(idOf);
    const stagedIDs = state.committed?.stagedIDs || [];
    let previous = -1;
    const stagedIndexes = [];
    for (const stagedID of stagedIDs) {
      const index = ids.indexOf(stagedID, previous + 1);
      if (index < 0) {
        return evaluated(state, lastAdmitted(state, items), {
          nextPhase: 'holding',
          clearCommitted: true,
        });
      }
      stagedIndexes.push(index);
      previous = index;
    }
    const stagedSet = new Set(stagedIDs);
    let admitted;
    let deferred;
    if (state.uiBaselineIDs.length) {
      let cursor = previous;
      for (const baselineID of state.uiBaselineIDs) {
        cursor = ids.indexOf(baselineID, cursor + 1);
        if (cursor < 0) {
          return evaluated(state, lastAdmitted(state, items), {
            nextPhase: 'holding',
            clearCommitted: true,
          });
        }
      }
      const firstBaseline = ids.indexOf(state.uiBaselineIDs[0], previous + 1);
      const prefix = items.slice(0, firstBaseline);
      admitted = [
        ...prefix.filter((item) => stagedSet.has(idOf(item))),
        ...state.releaseBaselineItems,
      ];
      deferred = prefix.filter((item) => !stagedSet.has(idOf(item)));
    } else {
      const lastStaged = stagedIndexes.at(-1) ?? -1;
      const prefix = items.slice(0, lastStaged + 1);
      admitted = [
        ...prefix.filter((item) => stagedSet.has(idOf(item))),
        ...state.releaseBaselineItems,
      ];
      deferred = prefix.filter((item) => !stagedSet.has(idOf(item)));
    }
    return evaluated(state, admitted, {
      deferredIDs: Object.freeze(deferred.map(idOf).filter(Boolean)),
    });
  }

  function observe(channelId, items, meta = {}) {
    const state = channels.get(channelId);
    if (!state || state.phase !== 'pending') {
      return { stagedIDs: [], completeUnits: 0, fulfilled: false };
    }
    if (String(meta.operationID || '') !== state.token.operationID
      || String(meta.viewID || '') !== state.viewID
      || String(meta.epoch || '') !== state.epoch) {
      return { stagedIDs: [], completeUnits: 0, fulfilled: false, stale: true };
    }
    const result = observeCandidate(state, items, meta);
    return {
      stagedIDs: result.stagedIDs,
      completeUnits: result.completeUnits,
      fulfilled: result.fulfilled,
      rebased: result.rebased === true,
      stale: false,
    };
  }

  // Render evaluates an immutable candidate. Only commitCandidate, called from
  // Timeline's committed layout effect, may publish its bookkeeping into the
  // admission owner. A suspended or aborted render therefore has no authority.
  function evaluate(channelId, items, meta = {}) {
    const state = channels.get(channelId);
    if (!state) return Object.freeze({ items, receipt: null });
    if (String(meta.viewID || '') !== state.viewID || String(meta.epoch || '') !== state.epoch) {
      // A stale view may never bypass Admission and publish raw rows. Preserve
      // only identities already admitted by this authority; reconcileCurrent
      // retires the obsolete transaction after the render commits.
      return Object.freeze({ items: lastAdmitted(state, items), receipt: null });
    }
    if (state.phase === 'committed-awaiting-layout') return evaluateCommitted(state, items);
    return evaluatePending(state, items);
  }

  function commitCandidate(channelId, candidate) {
    const receipt = candidate?.receipt;
    const state = channels.get(channelId);
    if (!receipt) return false;
    if (!state
      || receipt.state !== state
      || receipt.authorityRevision !== state.authorityRevision
      || receipt.phase !== state.phase
      || receipt.viewID !== state.viewID
      || receipt.epoch !== state.epoch) {
      // The committed React tree was evaluated against an owner version that
      // has since moved. Ask for a fresh candidate; never publish stale render
      // bookkeeping into the newer transaction.
      onChange(channelId);
      return false;
    }
    state.lastAdmittedIDs = receipt.admittedIDs;
    if (receipt.deferredIDs) state.deferredIDs = receipt.deferredIDs;
    const phaseChanged = receipt.nextPhase && receipt.nextPhase !== state.phase;
    if (receipt.nextPhase) state.phase = receipt.nextPhase;
    if (receipt.clearCommitted) state.committed = null;
    advanceAuthority(state);
    if (phaseChanged) onChange(channelId);
    return true;
  }

  function settle(channelId, outcome = 'fulfilled') {
    const state = channels.get(channelId);
    if (!state || state.phase !== 'pending') return null;
    if (!state.stagedIDs.length) {
      reset(channelId);
      onChange(channelId);
      return null;
    }
    // Publish existing-row revisions first. The prefix remains withheld until
    // Timeline has committed this admitted baseline as a separate snapshot.
    state.phase = 'pending-baseline-commit';
    state.committed = frozenToken(state.token, {
      outcome,
      stagedIDs: state.stagedIDs,
      candidateSourceRevision: state.candidateSourceRevision,
      commitID: `${state.token.operationID}:history-reveal`,
      candidatePresentationRevision: 0,
    });
    advanceAuthority(state);
    onChange(channelId);
    return state.committed;
  }

  function reconcileCurrent(channelId, meta = {}) {
    const state = channels.get(channelId);
    if (!state) return false;
    if (String(meta.viewID || '') === state.viewID
      && String(meta.epoch || '') === state.epoch) return false;
    reset(channelId);
    onChange(channelId);
    return true;
  }

  function cancel(channelId, operationID, { sourceRevision } = {}) {
    const state = channels.get(channelId);
    if (!state || state.token.operationID !== operationID) return false;
    const capturedSourceRevision = Number(sourceRevision);
    if (Number.isSafeInteger(capturedSourceRevision) && capturedSourceRevision >= 0) {
      state.releaseSourceRevision = Math.max(
        Number(state.releaseSourceRevision || 0),
        capturedSourceRevision,
      );
      state.sourceFenceActive = true;
    }
    if (state.phase === 'committed-awaiting-layout') {
      finishCommitted(state);
      if (channels.has(channelId)) advanceAuthority(state);
      onChange(channelId);
      return true;
    }
    if (!['pending', 'pending-baseline-commit'].includes(state.phase)) return false;
    state.phase = 'holding';
    state.token = frozenToken(state.token, { cancelled: true });
    state.committed = null;
    advanceAuthority(state);
    onChange(channelId);
    return true;
  }

  function finishCommitted(state) {
    if (state.deferredIDs.length) {
      state.phase = 'holding';
      state.durableBaselineIDs = Object.freeze([
        ...state.committed.stagedIDs, ...state.durableBaselineIDs,
      ]);
      state.uiBaselineIDs = Object.freeze([...state.committed.stagedIDs, ...state.uiBaselineIDs]);
      state.stagedIDs = state.deferredIDs;
      state.completeUnits = state.deferredIDs.length;
      state.deferredIDs = Object.freeze([]);
      state.committed = null;
      return;
    }
    reset(state.channelId);
  }

  // Continued older input renews the same history intent; it does not weaken
  // the exact input-epoch gate. Every other direction cancels in ReadingSession
  // and therefore never reaches this method.
  function advanceInputEpoch(channelId, {
    operationID, activationID, direction, inputEpoch, currentInputEpoch, intentRevision,
  } = {}) {
    const state = channels.get(channelId);
    const nextEpoch = Number(inputEpoch);
    const nextIntentRevision = intentRevision == null
      ? Number(state?.token?.intentRevision)
      : Number(intentRevision);
    if (!state
      || !['pending', 'pending-baseline-commit', 'committed-awaiting-layout'].includes(state.phase)
      || direction !== 'older'
      || state.token.operationID !== operationID
      || state.token.activationID !== activationID
      || !Number.isFinite(nextEpoch)
      || nextEpoch !== Number(currentInputEpoch)
      || nextEpoch <= Number(state.token.inputEpoch || 0)
      || (intentRevision != null && !Number.isFinite(nextIntentRevision))) return null;
    const previousInputEpoch = Number(state.token.inputEpoch || 0);
    const identity = { inputEpoch: nextEpoch };
    if (intentRevision != null) identity.intentRevision = nextIntentRevision;
    state.token = frozenToken(state.token, identity);
    if (state.committed) state.committed = frozenToken(state.committed, identity);
    advanceAuthority(state);
    onChange(channelId);
    return Object.freeze({
      operationID, activationID, fromInputEpoch: previousInputEpoch, toInputEpoch: nextEpoch,
    });
  }

  function prepareCommit(channelId, presentationSnapshot) {
    const state = channels.get(channelId);
    if (!state?.committed || state.phase !== 'pending-baseline-commit') return false;
    const rows = presentationSnapshot?.rows || [];
    const baselineIDs = rows.map((row) => row?.id).filter(Boolean);
    if (baselineIDs.length !== state.lastAdmittedIDs.length
      || baselineIDs.some((id, index) => id !== state.lastAdmittedIDs[index])) return false;
    state.phase = 'committed-awaiting-layout';
    // Presentation rows own detached, deeply-frozen bodies. Capture those
    // exact committed semantics rather than shallow references into Fold.
    state.releaseBaselineItems = Object.freeze(rows.map((row) => row.body));
    state.releaseSourceRevision = Number(presentationSnapshot?.sourceRevision || 0);
    state.sourceFenceActive = true;
    state.committed = frozenToken(state.committed, {
      baselineSettledPresentationRevision: Number(presentationSnapshot?.revision || 0),
    });
    advanceAuthority(state);
    onChange(channelId);
    return true;
  }

  // Pinning the source revision keeps existing rows' heights still while the
  // reveal's position lease is being painted. That window is the
  // committed-awaiting-layout phase and nothing else: a cancelled or held
  // transaction must never freeze progress and terminal updates of rows the
  // reader already has.
  function sourceFence(channelId) {
    const state = channels.get(channelId);
    return state?.sourceFenceActive === true && state.phase === 'committed-awaiting-layout'
      ? Number(state.releaseSourceRevision || 0)
      : null;
  }

  // Grant publication before ConversationPresentation commits it. The grant
  // binds the exact Admission candidate, token and authority revision; it does
  // not mutate either owner. Timeline may publish only a granted candidate.
  function validatePresentation(channelId, candidate, presentationSnapshot = {}, viewportAuthority = {}) {
    const state = channels.get(channelId);
    if (!state?.committed || state.phase !== 'committed-awaiting-layout') {
      return Object.freeze({ accepted: false, reason: 'not-awaiting-layout' });
    }
    const receipt = candidate?.receipt;
    if (!receipt
      || receipt.state !== state
      || receipt.authorityRevision !== state.authorityRevision
      || receipt.phase !== state.phase
      || receipt.viewID !== state.viewID
      || receipt.epoch !== state.epoch) {
      return Object.freeze({ accepted: false, reason: 'stale-transaction' });
    }
    const currentOwner = viewportAuthority || {};
    if (String(currentOwner.activationID || '') !== String(state.committed.activationID || '')
      || Number(currentOwner.inputEpoch) !== Number(state.committed.inputEpoch)
      || (state.committed.intentRevision != null
        && Number(currentOwner.intentRevision) !== Number(state.committed.intentRevision))
      || String(currentOwner.viewID || '') !== state.viewID
      || String(currentOwner.epoch || '') !== state.epoch) {
      return Object.freeze({ accepted: false, reason: 'stale-viewport-owner' });
    }
    const changes = presentationSnapshot.changes || {};
    const stagedIDs = state.committed.stagedIDs || [];
    const emptyBaseline = state.uiBaselineIDs.length === 0;
    const insertedIDs = emptyBaseline
      ? (changes.inserted || [])
      : (changes.frontInsertedIDs || []);
    const exactIDs = insertedIDs.length === stagedIDs.length
      && insertedIDs.every((id, index) => id === stagedIDs[index]);
    const noPollution = (changes.backInsertedIDs || []).length === 0
      && (changes.removed || []).length === 0
      && (changes.updated || []).length === 0;
    const structuralCommit = emptyBaseline
      ? noPollution
        && (presentationSnapshot.rows || []).length === stagedIDs.length
        && (presentationSnapshot.rows || []).every((row, index) => row?.id === stagedIDs[index])
      : changes.kind === 'prepend' && noPollution;
    if (!exactIDs || !structuralCommit) {
      return Object.freeze({
        accepted: false,
        reason: !exactIDs ? 'identity-mismatch' : 'structure-mismatch',
      });
    }
    return Object.freeze({
      accepted: true,
      grant: Object.freeze({
        state,
        authorityRevision: state.authorityRevision,
        commitToken: state.committed,
        candidate,
        presentationRevision: Number(presentationSnapshot.revision || 0),
      }),
    });
  }

  function rejectPresentation(channelId, commitToken) {
    const state = channels.get(channelId);
    if (!state?.committed
      || state.phase !== 'committed-awaiting-layout'
      || state.committed !== commitToken) return false;
    state.phase = 'holding';
    state.committed = null;
    state.releaseBaselineItems = Object.freeze([]);
    state.releaseSourceRevision = 0;
    state.sourceFenceActive = false;
    advanceAuthority(state);
    onChange(channelId);
    return true;
  }

  // ConversationPresentation has committed the exact granted candidate. Now
  // publish the matching Admission bookkeeping and finish the transaction in
  // the same layout turn. A stale grant is a no-op; it cannot reject a newer
  // token or roll back rows that another owner already published.
  function commitPresentationGrant(channelId, grant) {
    const state = channels.get(channelId);
    if (!grant
      || !state
      || grant.state !== state
      || grant.authorityRevision !== state.authorityRevision
      || grant.commitToken !== state.committed
      || state.phase !== 'committed-awaiting-layout') return false;
    if (commitCandidate(channelId, grant.candidate) !== true) return false;
    if (state.committed !== grant.commitToken || state.phase !== 'committed-awaiting-layout') return false;
    state.committed = frozenToken(state.committed, {
      candidatePresentationRevision: grant.presentationRevision,
    });
    finishCommitted(state);
    if (channels.has(channelId)) advanceAuthority(state);
    onChange(channelId);
    return true;
  }

  function acknowledge(channelId, commitID) {
    const state = channels.get(channelId);
    if (!state?.committed
      || state.phase !== 'committed-awaiting-layout'
      || state.committed.commitID !== commitID) return false;
    finishCommitted(state);
    if (channels.has(channelId)) advanceAuthority(state);
    onChange(channelId);
    return true;
  }

  function snapshot(channelId) {
    const state = channels.get(channelId);
    return Object.freeze({
      phase: state?.phase || 'idle',
      token: state?.token || null,
      stagedIDs: state?.stagedIDs || Object.freeze([]),
      completeUnits: Number(state?.completeUnits || 0),
      committed: state?.committed || null,
    });
  }

  return Object.freeze({
    begin, observe, evaluate, commitCandidate, settle, cancel, advanceInputEpoch,
    prepareCommit, sourceFence, validatePresentation,
    rejectPresentation, commitPresentationGrant, acknowledge,
    snapshot, reset, reconcileCurrent,
  });
}
