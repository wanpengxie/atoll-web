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

export function historyConsumerObligation({ intent, targetSeq, requiredVisibleCoverage, firstRow, status }) {
  return Object.freeze({
    key: JSON.stringify([
      intent, Number(targetSeq || 0), String(requiredVisibleCoverage?.messageID || ''),
      Number(requiredVisibleCoverage?.seq || 0),
      `${firstRow?.id || ''}:${firstRow?.seqLow || 0}`,
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

export function historyRevealIntent({ intent, activationID, inputEpoch, epoch, viewKey, channelID, status, snapshot, demandUnits }) {
  if (intent !== HISTORY_INTENT.scrollHistory) return null;
  const rows = snapshot.rows || [];
  const first = rows[0];
  return Object.freeze({
    activationID,
    inputEpoch,
    operationID: `history:${activationID}:${epoch}`,
    viewID: viewKey,
    epoch: `${channelID}:${Number(status.generation || 0)}`,
    baselinePresentationRevision: Number(snapshot.revision || 0),
    uiBaselineIDs: Object.freeze(rows.map((row) => row.id)),
    durableBaselineIDs: Object.freeze(rows.filter((row) => !row.localState && row.body?.local !== true).map((row) => row.id)),
    anchorID: first?.id || '',
    anchorSeq: Number(first?.seqLow || 0),
    demandUnits: Math.max(1, Math.min(24, Number(demandUnits) || 1)),
  });
}
