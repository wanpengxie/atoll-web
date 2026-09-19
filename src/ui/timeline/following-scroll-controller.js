import { READING_MODE } from '../../model/reading-session.js';
import { advanceSendScrollTransaction, createSendScrollTransaction,
  sendScrollTransactionCanWrite } from '../../model/send-scroll-transaction.js';

const validFor = (token, current, binding) => Boolean(token && token.activationID === current.activationID
  && token.inputEpoch === current.inputEpoch && token.snapshotRevision === binding.snapshotRevision
  && token.roleRevision === Number(binding.roleRevision || 0));

export const invalidateFollowingSend = (transactionRef, current) => {
  transactionRef.current = advanceSendScrollTransaction(transactionRef.current,
    { type: 'invalidate', activationID: current.activationID, inputEpoch: current.inputEpoch - 1 });
};

export function resetFollowingScroll(control, reading, current) {
  const authorized = current.mode === READING_MODE.following
    && reading.initializing !== true && reading.bottomReady !== false;
  control.followAuthorization.current = {
    activationID: reading.activationID,
    inputEpoch: current.inputEpoch,
    authorized,
  };
  for (const ref of [control.followRevision, control.viewport, control.layoutHeight,
    control.role, control.intentGeometry, control.sendTransaction, control.sendOwnedRevision,
    control.itemLayout]) ref.current = null;
  control.lastListHeight.current = 0;
  control.viewportSize.current = null;
}

export function commitFollowingPresentation({ control, current, previous, snapshot }) {
  const previousRows = previous.rows;
  const previousTail = previousRows.at(-1);
  const nextTail = snapshot.rows.at(-1);
  const nextRevision = Number(snapshot.revision || 0);
  const nextRoleRevision = Number(snapshot.roleRevision || 0);
  const intent = current.bottomIntent?.id && current.bottomIntent.inputEpoch === current.inputEpoch
    ? current.bottomIntent : null;
  const targets = intent?.targetMessageIDs || [];
  const ownsRevision = Boolean(intent
    && nextRevision > Math.max(0, Number(intent.afterPresentationRevision) || 0));
  const inserted = snapshot.changes?.inserted || [];
  const updated = snapshot.changes?.updated || [];
  const removed = snapshot.changes?.removed || [];
  const ownsDelta = ownsRevision && [...inserted, ...updated, ...removed]
    .some((id) => targets.includes(id));
  const nonTargetDelta = ownsDelta && (inserted.some((id) => !targets.includes(id)
    && !previousRows.some((row) => row.id === id))
    || updated.some((id) => !targets.includes(id))
    || removed.some((id) => !targets.includes(id) && !snapshot.rows.some((row) => row.id === id)));

  if (ownsDelta) {
    const ack = control.itemLayout.current;
    const observed = Boolean(ack && ack.activationID === current.activationID
      && ack.inputEpoch === current.inputEpoch && ack.snapshotRevision === nextRevision
      && ack.roleRevision === nextRoleRevision);
    const baseline = observed ? Number(ack.firstHeight ?? ack.height ?? 0) : 0;
    const later = observed ? Number(ack.height ?? baseline) : 0;
    control.sendOwnedRevision.current = {
      intentID: intent.id,
      activationID: current.activationID,
      inputEpoch: current.inputEpoch,
      snapshotRevision: nextRevision,
      roleRevision: nextRoleRevision,
      baselineObserved: observed,
      baselineHeight: baseline,
      independentOrdinary: nonTargetDelta,
    };
    if (observed) {
      control.layoutHeight.current = nonTargetDelta || later !== baseline
        ? (current.mode === READING_MODE.following ? {
          activationID: current.activationID,
          inputEpoch: current.inputEpoch,
          snapshotRevision: nextRevision,
          roleRevision: nextRoleRevision,
          height: later,
          tokenID: `height:child-first:${current.activationID}:${current.inputEpoch}:${nextRevision}:${ack.ackSeq || 1}`,
        } : null) : null;
    }
  }
  const send = control.sendTransaction.current;
  if (send && (send.activationID !== current.activationID || send.inputEpoch !== current.inputEpoch)) {
    control.sendTransaction.current = null;
  }
  const previousTailIndex = previousTail?.id
    ? snapshot.rows.findIndex((row) => row.id === previousTail.id) : -1;
  const extendsTail = previousTailIndex >= 0 && previousTailIndex < snapshot.rows.length - 1
    && snapshot.rows.slice(previousTailIndex + 1).some((row) => inserted.includes(row.id));
  const tailChanged = previousTail?.id !== nextTail?.id
    || previousTail?.contentRevision !== nextTail?.contentRevision || previousTail !== nextTail;
  const tailRevision = nextRevision > Number(previous.snapshotRevision || 0) && tailChanged
    && (snapshot.changes?.kind === 'append' || extendsTail
      || (snapshot.changes?.kind === 'revise' && updated.includes(nextTail?.id)));
  if (tailRevision && current.mode === READING_MODE.following && (!ownsDelta || nonTargetDelta)) {
    control.followRevision.current = {
      activationID: current.activationID,
      inputEpoch: current.inputEpoch,
      snapshotRevision: nextRevision,
      roleRevision: nextRoleRevision,
      tokenID: `presentation:${current.activationID}:${current.inputEpoch}:${nextRevision}`,
      independent: nonTargetDelta,
    };
  } else if (nextRevision > Number(previous.snapshotRevision || 0)) control.followRevision.current = null;

  const roleUpdated = snapshot.roleChanges?.updated || [];
  if (nextRoleRevision > Number(previous.roleRevision || 0)) {
    const ack = control.itemLayout.current;
    const ready = Boolean(ack && ack.activationID === current.activationID
      && ack.inputEpoch === current.inputEpoch && ack.snapshotRevision === nextRevision
      && ack.roleRevision === nextRoleRevision);
    control.role.current = current.mode === READING_MODE.following && roleUpdated.length ? {
      activationID: current.activationID,
      inputEpoch: current.inputEpoch,
      snapshotRevision: nextRevision,
      roleRevision: nextRoleRevision,
      updatedIDs: Object.freeze([...roleUpdated]),
      ready: ready && !intent,
      blocked: Boolean(intent),
      height: ready ? Number(ack.height || 0) : 0,
      tokenID: `role:${current.activationID}:${current.inputEpoch}:${nextRoleRevision}`,
    } : null;
    if (ready) {
      if (validFor(control.layoutHeight.current, current, {
        snapshotRevision: nextRevision, roleRevision: nextRoleRevision,
      })) control.layoutHeight.current = null;
      if (intent) control.role.current = null;
    }
  }
  return control.role.current?.ready === true;
}

// Owns authorization consumption and returns commands without touching DOM.
export function decideFollowingScroll({
  source,
  binding,
  presentation,
  geometry,
  control,
  trace,
}) {
  const reject = (reason, detail = {}) => {
    trace('issuer-reject', { source, reason, ...geometry, ...detail });
    return null;
  };
  trace('issuer-enter', { source, ...geometry });
  if (!binding) return reject('no-binding');
  if (!geometry.canScroll) return reject('no-scroll-method');

  const owner = binding.reading;
  const current = owner.getSession?.() || owner.session;
  const intent = current.bottomIntent?.id ? current.bottomIntent : null;
  if (binding.activationID !== current.activationID) return reject('owner-activation');
  const validIntent = Boolean(intent?.id && intent.inputEpoch === current.inputEpoch);
  const latestIntent = validIntent && String(intent.id).startsWith('latest:');
  if (validIntent && control.intentGeometry.current?.id !== intent.id) {
    control.intentGeometry.current = { id: intent.id, scrollHeight: geometry.scrollHeight };
  }
  const afterPresentationRevision = Math.max(0, Number(intent?.afterPresentationRevision) || 0);
  const sendTargets = String(intent?.id || '').startsWith('composer:send-start:')
    ? (intent?.targetMessageIDs || []) : [];
  if (validIntent && sendTargets.length && control.sendTransaction.current?.intentID !== intent.id) {
    control.sendTransaction.current = createSendScrollTransaction(intent, current.activationID);
  }

  const itemLayout = control.itemLayout.current;
  const validItemLayout = validFor(itemLayout, current, binding);
  let sendTransaction = control.sendTransaction.current;
  if (sendTransaction && presentation?.ready === true
    && presentation.intentID === intent?.id
    && presentation.activationID === current.activationID
    && presentation.inputEpoch === current.inputEpoch) {
    sendTransaction = advanceSendScrollTransaction(sendTransaction, {
      type: 'ready',
      activationID: current.activationID,
      inputEpoch: current.inputEpoch,
      intentID: intent.id,
      targetIDs: sendTargets,
      revision: Number(presentation.presentationRevision || binding.snapshotRevision || 0),
      destinations: presentation.destinations,
    });
    if (sendTransaction?.destination === 'waiting'
      && sendTransaction.readyRevision === Number(presentation.presentationRevision || binding.snapshotRevision || 0)) {
      sendTransaction = advanceSendScrollTransaction(sendTransaction, {
        type: 'measured',
        activationID: current.activationID,
        inputEpoch: current.inputEpoch,
        revision: sendTransaction.readyRevision,
      });
    }
  }
  if (sendTransaction && validItemLayout) {
    sendTransaction = advanceSendScrollTransaction(sendTransaction, {
      type: 'measured',
      activationID: current.activationID,
      inputEpoch: current.inputEpoch,
      revision: itemLayout.snapshotRevision,
      height: itemLayout.height,
      targetIDs: sendTargets.filter((id) => itemLayout.rowIDs.includes(id)),
    });
  }
  control.sendTransaction.current = sendTransaction;

  const targetCommitted = validIntent && (sendTargets.length
    ? sendScrollTransactionCanWrite(sendTransaction)
    : latestIntent || Number(binding.snapshotRevision || 0) > afterPresentationRevision);
  const revision = control.followRevision.current;
  const validRevision = validFor(revision, current, binding) && current.mode === READING_MODE.following;
  const viewport = control.viewport.current;
  const validViewport = Boolean(viewport
    && viewport.activationID === current.activationID
    && viewport.inputEpoch === current.inputEpoch
    && current.mode === READING_MODE.following);
  const role = control.role.current;
  const validRole = Boolean(!validIntent && validFor(role, current, binding)
    && role.ready === true && current.mode === READING_MODE.following);
  let owned = control.sendOwnedRevision.current;
  const ownsRevision = Boolean(validIntent && owned
    && owned.intentID === intent.id
    && owned.activationID === current.activationID
    && owned.inputEpoch === current.inputEpoch);

  if (owned && !ownsRevision) {
    if (owned.activationID === current.activationID
      && owned.inputEpoch === current.inputEpoch
      && owned.snapshotRevision === Number(binding.snapshotRevision || 0)
      && current.mode === READING_MODE.following
      && owned.baselineObserved === true
      && !validFor(control.layoutHeight.current, current, binding)) {
      control.layoutHeight.current = {
        activationID: current.activationID,
        inputEpoch: current.inputEpoch,
        snapshotRevision: Number(binding.snapshotRevision || 0),
        roleRevision: Number(binding.roleRevision || 0),
        height: Number(owned.baselineHeight),
        tokenID: `height:released-send:${owned.intentID}:${binding.snapshotRevision}`,
      };
    }
    control.sendOwnedRevision.current = null;
    owned = null;
  }
  const height = control.layoutHeight.current;
  const validHeight = validFor(height, current, binding) && current.mode === READING_MODE.following;
  const followAuthorization = control.followAuthorization.current;
  const activationFollow = Boolean(
    followAuthorization?.authorized === true
    && followAuthorization.activationID === current.activationID
    && followAuthorization.inputEpoch === current.inputEpoch
    && current.mode === READING_MODE.following
  );
  const intentOwnsRevision = ownsRevision && owned?.snapshotRevision === binding.snapshotRevision;
  const ordinaryRevision = validRevision && (!intentOwnsRevision || revision.independent === true);
  const authorization = targetCommitted
    ? { kind: 'send-ready', tokenID: `intent:${intent.id}`, label: 'intent' }
    : !validIntent && activationFollow ? {
      kind: 'activation',
      tokenID: `activation:${current.activationID}:${current.inputEpoch}`,
      label: 'following-activation',
    }
      : ordinaryRevision ? { kind: 'presentation', tokenID: revision.tokenID, label: 'presentation-revision' }
      : validRole ? { kind: 'role', tokenID: role.tokenID, label: 'presentation-role' }
        : validViewport ? { kind: 'viewport', tokenID: viewport.tokenID
          || `viewport:${current.activationID}:${current.inputEpoch}:${viewport.geometryRevision}`,
        label: 'viewport-revision' }
          : validHeight ? { kind: 'height', tokenID: height.tokenID
            || `height:${current.activationID}:${current.inputEpoch}:${binding.snapshotRevision}:${height.height}`,
          label: 'presentation-height' } : null;

  if (!authorization && validIntent) return reject('intent-target-pending', {
    intentID: intent.id,
    snapshotRevision: Number(binding.snapshotRevision || 0),
    afterPresentationRevision,
    targetMessageIDs: sendTargets,
    sendTransaction: sendTransaction ? {
      readyRevision: sendTransaction.readyRevision,
      measuredRevision: sendTransaction.measuredRevision,
    } : null,
  });
  if (!authorization) return reject('not-authorized', {
    snapshotRevision: Number(binding.snapshotRevision || 0),
    intentID: intent?.id || '',
  });
  if (owner.initializing && !latestIntent) return reject('initializing');
  if (owner.bottomReady === false && !latestIntent) return reject('bottom-not-ready');
  if (!binding.rows.length) return reject('no-rows');
  if (geometry.offsetHeight <= 0 || geometry.clientHeight <= 0 || geometry.scrollHeight <= 0) {
    return reject('zero-geometry');
  }
  if (authorization.kind === 'activation'
    && geometry.scrollHeight <= geometry.clientHeight + 1
    && geometry.completeRange !== true) {
    return reject('activation-layout-pending', {
      snapshotRevision: Number(binding.snapshotRevision || 0),
    });
  }

  const baselineHeight = control.intentGeometry.current
    && control.intentGeometry.current.id === intent?.id
    ? Number(control.intentGeometry.current.scrollHeight || 0) : 0;
  if (authorization.kind === 'presentation' && !validItemLayout) {
    return reject('presentation-layout-pending', { snapshotRevision: binding.snapshotRevision });
  }
  if (authorization.kind === 'presentation' && itemLayout.height > geometry.scrollHeight) {
    return reject('presentation-layout-pending', {
      snapshotRevision: binding.snapshotRevision,
      measuredHeight: Number(itemLayout.height || 0),
    });
  }
  if (authorization.kind === 'height' && Number(height.height || 0) > geometry.scrollHeight) {
    return reject('presentation-layout-pending', {
      snapshotRevision: binding.snapshotRevision,
      measuredHeight: Number(height.height || 0),
    });
  }
  if (authorization.kind === 'role' && Number(role.height || 0) > geometry.scrollHeight) {
    return reject('presentation-layout-pending', {
      roleRevision: Number(binding.roleRevision || 0),
      measuredHeight: Number(role.height || 0),
    });
  }
  if (targetCommitted && !sendTargets.length && !latestIntent
    && geometry.scrollHeight <= baselineHeight && !validItemLayout) {
    return reject('intent-layout-pending', {
      intentID: intent.id,
      intentBaselineHeight: baselineHeight,
      snapshotRevision: binding.snapshotRevision,
    });
  }
  if (targetCommitted && sendTargets.length && sendTransaction?.destination !== 'waiting'
    && sendTransaction?.measuredHeight > geometry.scrollHeight) {
    return reject('intent-layout-pending', {
      intentID: intent.id,
      measuredHeight: sendTransaction.measuredHeight,
      snapshotRevision: binding.snapshotRevision,
    });
  }

  const consume = () => {
    if (authorization.kind === 'send-ready') {
      if (sendTargets.length) {
        control.sendTransaction.current = null;
        if (control.sendOwnedRevision.current?.intentID === intent.id) {
          control.sendOwnedRevision.current = null;
        }
      }
      owner.consumeBottomIntent(intent);
      control.intentGeometry.current = null;
    } else if (authorization.kind === 'activation') {
      // Following is a durable authorization for the activation, not a
      // one-shot command. Virtualized geometry can grow through several
      // commits after the first non-placeholder height; consuming authority on
      // that first write leaves the viewport at an intermediate maximum. The
      // authorization ends only when Reading changes mode or activation.
      // Lower-priority tokens for this commit are nevertheless covered by the
      // same canonical tail decision and must not accumulate.
      if (validRevision && control.followRevision.current === revision) {
        control.followRevision.current = null;
      }
      if (validHeight && control.layoutHeight.current === height) {
        control.layoutHeight.current = null;
      }
      if (validItemLayout) control.itemLayout.current = null;
      if (validViewport && control.viewport.current === viewport) control.viewport.current = null;
      if (validRole && control.role.current === role) control.role.current = null;
    } else if (authorization.kind === 'presentation') {
      if (control.followRevision.current === revision) control.followRevision.current = null;
      if (validItemLayout) control.itemLayout.current = null;
    } else if (authorization.kind === 'viewport') {
      if (control.viewport.current === viewport) control.viewport.current = null;
    } else if (authorization.kind === 'role') {
      if (control.role.current === role) control.role.current = null;
    } else if (control.layoutHeight.current === height) control.layoutHeight.current = null;
  };
  consume();
  const atTail = geometry.scrollHeight - geometry.clientHeight - geometry.scrollTop <= 1;
  const detail = {
    source,
    activationID: binding.activationID,
    inputEpoch: current.inputEpoch,
    snapshotRevision: binding.snapshotRevision,
    intentID: intent?.id || '',
    authorization: authorization.label,
    authorityLabel: authorization.label,
    authorizationToken: authorization.tokenID,
    sendDestination: sendTransaction?.destination || '',
    sendReadyRevision: Number(sendTransaction?.readyRevision || 0),
    sendTargetIDs: sendTargets,
    afterPresentationRevision,
    ...geometry,
  };
  if (atTail) {
    trace('issuer-satisfy', { ...detail, reason: 'already-at-tail' });
    return Object.freeze({ command: null, observe: true });
  }
  trace('issuer-write', detail);
  return Object.freeze({ command: Object.freeze({ type: 'scroll-tail' }), observe: true });
}
