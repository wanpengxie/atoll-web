import { HISTORY_INTENT } from '../../model/history-demand.js';

export const HISTORY_CONSUMER = Object.freeze({ viewportUnderfill: 'viewport-underfill' });

const BLOCKING_ADMISSION_PHASES = new Set(['pending-baseline-commit', 'committed-awaiting-layout']);
const ADDRESSABLE_ADMISSION_PHASES = new Set(['pending', ...BLOCKING_ADMISSION_PHASES]);

export function blockingAdmission(status, owner) {
  const authority = status?.presentationAdmission;
  const state = authority?.snapshot?.(owner.channelID) || status?.presentationAdmissionState;
  if (!state || !BLOCKING_ADMISSION_PHASES.has(state.phase)) return null;
  const token = state.token || state.committed;
  if (!token) return authority?.snapshot ? null : state;
  return token.activationID === owner.activationID
    && token.viewID === owner.viewKey
    && token.epoch === `${owner.channelID}:${Number(status?.generation || 0)}`
    ? state : null;
}

export function admissionOperationID(status, owner) {
  const state = status?.presentationAdmission?.snapshot?.(owner.channelID);
  const token = state?.token || state?.committed;
  return state && ADDRESSABLE_ADMISSION_PHASES.has(state.phase)
    && token?.activationID === owner.activationID
    && token?.viewID === owner.viewKey
    && token?.epoch === `${owner.channelID}:${Number(status?.generation || 0)}`
    ? String(token.operationID || '') : '';
}

export function historyProgressKey(status = {}) {
  return JSON.stringify([
    Number(status.generation || 0), status.attached === true,
    status.messageCurrent === true, status.hasOlder === true, status.loading === true,
    Number(status.completedPages || 0), Number(status.revealVersion || 0),
    Number(status.presentationRevision || 0), Number(status.retryAt || 0),
    String(status.error || ''), Number(status.historyDemand?.revision || 0),
    String(status.sourceLease || ''),
  ]);
}

export function historySourceKey(status = {}) {
  return JSON.stringify([
    Number(status.generation || 0), status.attached === true,
    status.localReplicaReady === true, String(status.sourceLease || ''),
  ]);
}

export function historySupplyKey(status = {}) {
  return JSON.stringify([
    historySourceKey(status), Number(status.oldestSeq || 0),
    Number(status.completedPages || 0), Number(status.revealVersion || 0),
    Number(status.buffered || 0), status.hasOlder === true,
  ]);
}

export function historyConsumerObligation({
  intent, targetSeq, requiredVisibleCoverage, firstRow, status, historyStartIntent = null,
}) {
  const historyStartKey = historyStartIntent?.type === 'history-start'
    ? [
      historyStartIntent.id, historyStartIntent.activationID, historyStartIntent.channelID,
      historyStartIntent.viewKey, Number(historyStartIntent.generation || 0),
      String(historyStartIntent.sourceLease || ''), Number(historyStartIntent.inputEpoch || 0),
      Number(historyStartIntent.intentRevision || 0), historyStartIntent.direction,
    ].join(':')
    : '';
  return Object.freeze({
    key: JSON.stringify([
      historyStartKey || intent, Number(targetSeq || 0), String(requiredVisibleCoverage?.messageID || ''),
      Number(requiredVisibleCoverage?.seq || 0), historyStartKey
        ? ''
        : `${firstRow?.id || ''}:${firstRow?.seqLow || 0}`,
    ]),
    sourceKey: historySourceKey(status),
    supplyKey: historySupplyKey(status),
    progressKey: historyProgressKey(status),
  });
}

export function ownsHistoryOperation(currentOwner, requestOwner, controller, activePromise, promise) {
  return currentOwner.controller === controller
    && currentOwner.activationID === requestOwner.activationID
    && currentOwner.channelID === requestOwner.channelID
    && currentOwner.viewKey === requestOwner.viewKey
    && Number(currentOwner.historyStatus?.generation || 0)
      === Number(requestOwner.historyStatus?.generation || 0)
    && activePromise === promise;
}

export function historyRevealIntent({
  intent, activationID, inputEpoch, intentRevision, epoch, viewKey, channelID,
  status, snapshot, demandUnits, historyAnchor = null, historyStart = false,
}) {
  if (intent !== HISTORY_INTENT.scrollHistory) return null;
  const rows = snapshot.rows || [];
  const first = rows[0];
  const capturedAnchor = !historyStart && historyAnchor?.messageID
    && String(historyAnchor.messageID) === String(first?.id || '')
    && Number.isFinite(Number(historyAnchor.viewportOffset))
    ? historyAnchor : null;
  const anchorID = historyStart ? '' : String(capturedAnchor?.messageID || first?.id || '');
  const viewportOffset = Number(capturedAnchor?.viewportOffset);
  return Object.freeze({
    activationID,
    inputEpoch,
    intentRevision,
    operationID: `history:${activationID}:${epoch}`,
    viewID: viewKey,
    epoch: `${channelID}:${Number(status.generation || 0)}`,
    baselinePresentationRevision: Number(snapshot.revision || 0),
    uiBaselineIDs: Object.freeze(rows.map((row) => row.id)),
    durableBaselineIDs: Object.freeze(rows.filter((row) => !row.localState && row.body?.local !== true).map((row) => row.id)),
    anchorID,
    anchorSeq: historyStart ? 0 : Number(first?.seqLow || 0),
    // This is captured before the first older gesture, while the baseline is
    // still painted. Admission copies it into the accepted grant so the
    // Vendor adapter can restore the exact row-local viewport position after
    // prepend; a missing geometry sample deliberately yields no lease.
    messageID: historyStart ? '' : anchorID,
    viewportOffset: historyStart ? null : Number.isFinite(viewportOffset) ? viewportOffset : null,
    historyStart: historyStart === true,
    demandUnits: Math.max(1, Math.min(24, Number(demandUnits) || 1)),
  });
}
