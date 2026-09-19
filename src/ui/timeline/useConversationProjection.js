import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { emptyBrowsingFoldLease, reconcileBrowsingFoldLease } from '../../model/browsing-fold-lease.js';
import { createConversationPresentation } from '../../model/conversation-presentation.js';
import { diagnostic } from '../../model/diagnostics.js';
import { READING_MODE } from '../../model/reading-session.js';
import { projectTimeline } from '../../model/timeline-projection.js';
import { useColdEntryDiagnostics } from './useColdEntryDiagnostics.js';
import { usePresentationArrivalReceipt, useTimelineArrivalReceipt } from './useLiveArrivalReceipts.js';
import { useReadingSession } from './useReadingSession.js';
export function useConversationProjection({
  state,
  history,
  viewSessions,
  historyViewSpec,
  messageListKey,
  timelineLocalEchoes,
  identityPending,
  surfaceVisible,
  onTailCaughtUp,
}) {
  const presentationRef = useRef(null);
  if (!presentationRef.current) presentationRef.current = createConversationPresentation();
  const [commitVersion, setCommitVersion] = useState(0);
  const projectionVersion = state._timelineProjectionVersion ?? state.lastSeq;
  const contentVersion = state._timelineRevision ?? state.lastSeq;
  const projection = useMemo(() => {
    const admission = history.status?.presentationAdmission;
    let admissionCandidate = null;
    let presentationCandidate = null;
    const presentation = presentationRef.current;
    const renderAdmission = admission?.evaluate ? {
      admit(channelID, items, meta) {
        admissionCandidate = admission.evaluate(channelID, items, meta);
        return admissionCandidate.items;
      },
      sourceFence(channelID) {
        return admission.sourceFence?.(channelID);
      },
    } : admission;
    const renderPresentation = presentation.evaluate ? {
      project(items, meta) {
        presentationCandidate = presentation.evaluate(items, meta);
        return presentationCandidate.snapshot;
      },
    } : presentation;
    return {
      ...projectTimeline(state, {
        ...historyViewSpec,
        presentation: renderPresentation,
        presentationKey: messageListKey,
        dataEpoch: `${state.channelId}:${history.status?.generation || 0}`,
        localEchoes: timelineLocalEchoes,
        presentationAdmission: renderAdmission,
      }),
      admissionCandidate,
      presentationCandidate,
    };
  }, [
    state, projectionVersion, contentVersion, historyViewSpec, messageListKey,
    history.status?.generation, history.status?.presentationAdmission,
    history.status?.presentationAdmissionState?.phase,
    commitVersion, timelineLocalEchoes,
  ]);
  const historyReveal = history.status?.presentationAdmissionState?.phase === 'committed-awaiting-layout'
    ? history.status.presentationAdmissionState.committed
    : null;
  const arrivals = useTimelineArrivalReceipt(state);
  const viewport = useReadingSession({
    channelID: state.channelId,
    viewKey: messageListKey,
    snapshot: projection.presentation,
    history: { ...history, status: { ...history.status, historyReveal } },
    viewSessions,
    historyViewSpec,
    surfaceVisible,
    arrivals,
  });
  useLayoutEffect(() => {
    const admission = history.status?.presentationAdmission;
    const admissionState = admission?.snapshot?.(state.channelId);
    let presentationGrant = null;
    if (admissionState?.phase === 'committed-awaiting-layout') {
      const validation = admission.validatePresentation?.(
        state.channelId,
        projection.admissionCandidate,
        projection.presentationCandidate?.snapshot,
        viewport.currentAdmissionAuthority?.(),
      );
      diagnostic('debug', 'history.admission_commit_check', {
        channelId: state.channelId,
        operationID: admissionState.committed?.operationID || '',
        accepted: validation?.accepted === true,
        reason: validation?.reason || '',
        presentationRevision: projection.presentationCandidate?.snapshot?.revision || 0,
        inserted: projection.presentationCandidate?.snapshot?.changes?.frontInsertedIDs || [],
        staged: admissionState.committed?.stagedIDs || [],
        backInsertedIDs: projection.presentationCandidate?.snapshot?.changes?.backInsertedIDs || [],
        updated: projection.presentationCandidate?.snapshot?.changes?.updated || [],
        removed: projection.presentationCandidate?.snapshot?.changes?.removed || [],
        tokenInputEpoch: admissionState.committed?.inputEpoch,
      });
      if (validation?.accepted !== true) {
        if (validation?.reason !== 'stale-transaction') {
          admission.rejectPresentation?.(state.channelId, admissionState.committed);
        }
        setCommitVersion((value) => value + 1);
        return;
      }
      presentationGrant = validation.grant;
    }
    let presentationCommitted = true;
    if (projection.presentationCandidate) {
      presentationCommitted = presentationRef.current.commitCandidate(projection.presentationCandidate);
      if (!presentationCommitted && presentationRef.current.current() !== projection.presentation) {
        setCommitVersion((value) => value + 1);
      }
    }
    if (!presentationCommitted || !projection.admissionCandidate) return;
    if (presentationGrant) {
      if (admission.commitPresentationGrant?.(state.channelId, presentationGrant) !== true) {
        setCommitVersion((value) => value + 1);
        return;
      }
      diagnostic('debug', 'history.admission_commit', {
        channelId: state.channelId,
        operationID: presentationGrant.commitToken.operationID,
        activationID: presentationGrant.commitToken.activationID,
        inputEpoch: presentationGrant.commitToken.inputEpoch,
        presentationRevision: presentationGrant.presentationRevision,
        stagedIDs: presentationGrant.commitToken.stagedIDs || [],
      });
      return;
    }
    const admissionCommitted = admission?.commitCandidate?.(state.channelId, projection.admissionCandidate);
    if (admissionCommitted !== true && projection.admissionCandidate?.receipt) {
      setCommitVersion((value) => value + 1);
      return;
    }
    if (admissionCommitted === true
      && admission.snapshot?.(state.channelId)?.phase === 'pending-baseline-commit') {
      admission.prepareCommit?.(state.channelId, presentationRef.current.current());
    }
  }, [
    history.status?.presentationAdmission,
    projection.admissionCandidate,
    projection.presentation,
    projection.presentationCandidate,
    state.channelId,
    viewport.activationID,
    viewport.currentAdmissionAuthority,
    viewport.session.inputEpoch,
  ]);
  useLayoutEffect(() => {
    history.status?.presentationAdmission?.reconcileCurrent?.(state.channelId, {
      viewID: messageListKey,
      epoch: `${state.channelId}:${history.status?.generation || 0}`,
    });
  }, [history.status?.generation, history.status?.presentationAdmission, messageListKey, state.channelId]);
  useEffect(() => () => {
    history.status?.presentationAdmission?.reset?.(state.channelId);
  }, [history.status?.presentationAdmission, state.channelId]);
  useLayoutEffect(() => {
    if (history.status?.presentationAdmissionState?.phase !== 'pending-baseline-commit') return;
    history.status?.presentationAdmission?.prepareCommit?.(
      state.channelId,
      presentationRef.current.current(),
    );
  }, [
    history.status?.presentationAdmission,
    history.status?.presentationAdmissionState?.phase,
    projection.presentation,
    state.channelId,
  ]);
  const livePresentationArrivals = usePresentationArrivalReceipt({
    state,
    viewKey: messageListKey,
    surfaceVisible,
    sourceRevision: projection.presentation?.sourceRevision,
    presentation: projection.presentation,
    presentationOwner: presentationRef.current,
  });
  useLayoutEffect(() => {
    if (typeof onTailCaughtUp !== 'function') return undefined;
    onTailCaughtUp(viewport.tailCaughtUp);
    return () => onTailCaughtUp({ ...viewport.tailCaughtUp, caughtUp: false });
  }, [onTailCaughtUp, viewport.tailCaughtUp]);
  const latestRowID = viewport.presentationAuthority?.candidateID || '';
  useColdEntryDiagnostics({
    channelId: state.channelId,
    viewKey: messageListKey,
    selfReady: !identityPending,
    surfaceVisible,
    presentation: projection.presentation,
    reading: viewport,
    history,
  });
  const [browsingFoldLease, setBrowsingFoldLease] = useState(emptyBrowsingFoldLease);
  useLayoutEffect(() => {
    setBrowsingFoldLease((current) => reconcileBrowsingFoldLease(current, {
      activationID: viewport.activationID,
      mode: viewport.session.mode,
      rows: projection.presentation.rows,
      bookmarkID: viewport.session.bookmark?.messageID || '',
    }));
  }, [
    projection.presentation,
    viewport.activationID,
    viewport.session.bookmark?.messageID,
    viewport.session.mode,
  ]);
  const browsingExpandedSlots = useMemo(() => (
    viewport.session.mode === READING_MODE.browsing
      && browsingFoldLease.activationID === viewport.activationID
      ? new Set(browsingFoldLease.visualSlotIDs)
      : new Set()
  ), [browsingFoldLease, viewport.activationID, viewport.session.mode]);
  return {
    projection,
    viewport,
    latestRowID,
    browsingExpandedSlots,
    livePresentationArrivals,
  };
}
