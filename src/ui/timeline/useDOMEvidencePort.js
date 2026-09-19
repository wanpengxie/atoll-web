import { useEffect, useInsertionEffect, useMemo, useRef, useState } from 'react';
import {
  emptyDOMEvidence,
  observedDOMEvidence,
  transferDOMEvidence,
} from './dom-evidence-adapter.js';

function pageIsVisible() {
  return globalThis.document?.visibilityState !== 'hidden';
}

export function useDOMEvidencePort({
  owner,
  controller,
  historyStatus,
  snapshot,
  surfaceVisible,
}) {
  const [visibility, setVisibility] = useState(() => ({
    documentVisible: pageIsVisible(),
    revision: 0,
  }));
  const observationRevisionRef = useRef(0);
  const evidenceRef = useRef(emptyDOMEvidence({
    owner,
    controller,
    activationID: controller.activationID,
  }));
  const previousOwnerRef = useRef(owner);

  useEffect(() => {
    const publish = () => setVisibility((current) => ({
      documentVisible: pageIsVisible(),
      revision: current.revision + 1,
    }));
    globalThis.document?.addEventListener?.('visibilitychange', publish);
    return () => globalThis.document?.removeEventListener?.('visibilitychange', publish);
  }, []);

  useInsertionEffect(() => {
    const previous = previousOwnerRef.current;
    evidenceRef.current = transferDOMEvidence(evidenceRef.current, previous, owner, {
      controller,
      surfaceVisible,
      notificationAuthorityRevision: Number(historyStatus.notificationAuthorityRevision || 0),
      observationRevision: observationRevisionRef.current,
    });
    previousOwnerRef.current = owner;
  }, [controller, historyStatus.notificationAuthorityRevision, owner, surfaceVisible]);

  return useMemo(() => Object.freeze({
    documentVisible: visibility.documentVisible,
    visibilityRevision: visibility.revision,
    isDocumentVisible: pageIsVisible,
    current: () => evidenceRef.current,
    observationRevision: () => observationRevisionRef.current,
    observe(observation) {
      const revision = observationRevisionRef.current + 1;
      observationRevisionRef.current = revision;
      evidenceRef.current = observedDOMEvidence({
        owner,
        controller,
        activationID: observation.activationID || controller.activationID,
        observation,
        snapshot,
        historyStatus,
        observationRevision: revision,
      });
      return evidenceRef.current;
    },
    clear() {
      evidenceRef.current = emptyDOMEvidence({
        owner,
        controller,
        activationID: controller.activationID,
        notificationAuthorityRevision: Number(historyStatus.notificationAuthorityRevision || 0),
        observationRevision: observationRevisionRef.current,
      });
      return evidenceRef.current;
    },
    markReadPending(evidence, pending) {
      if (evidenceRef.current !== evidence) return false;
      evidenceRef.current = { ...evidence, readPending: pending === true };
      return true;
    },
  }), [controller, historyStatus, owner, snapshot, visibility]);
}
