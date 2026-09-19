import { useCallback, useEffect, useInsertionEffect, useRef } from 'react';
import { evidenceBelongsTo } from './dom-evidence-adapter.js';
import {
  createNotificationConfirmation,
  nextNotificationConfirmation,
  queuePresentedConfirmation,
  reconcileNotificationConfirmation,
  settleNotificationConfirmation,
} from './notification-confirmation-port.js';

export function useNotificationConfirmation({
  channelID,
  viewKey,
  controller,
  session,
  historyStatus,
  committedOwnerRef,
  domEvidence,
}) {
  const confirmationRef = useRef(createNotificationConfirmation(
    historyStatus.notificationAuthorityRevision,
    historyStatus.generation,
  ));
  const previousRef = useRef({ controller, mode: session.mode });

  useInsertionEffect(() => {
    const previous = previousRef.current;
    confirmationRef.current = reconcileNotificationConfirmation(confirmationRef.current, {
      authorityRevision: Number(historyStatus.notificationAuthorityRevision || 0),
      generation: Number(historyStatus.generation || 0),
      controllerChanged: previous.controller !== controller,
      previousMode: previous.mode,
      currentMode: session.mode,
      activationID: controller.activationID,
    });
    previousRef.current = { controller, mode: session.mode };
  }, [controller, domEvidence, historyStatus.generation, historyStatus.notificationAuthorityRevision, session.mode]);

  const acknowledgePresented = useCallback((presentedBoundary = 0) => {
    const owner = committedOwnerRef.current;
    const current = controller.getSnapshot().session;
    const evidence = domEvidence.current();
    if (owner.controller !== controller
      || !evidenceBelongsTo(evidence, { owner, controller, activationID: current.activationID })
      || evidence.atTail !== true
      || evidence.surfaceVisible !== true
      || current.mode !== 'following'
      || domEvidence.isDocumentVisible() !== true) return false;
    let confirmation = confirmationRef.current;
    if (confirmation.authorityRevision !== Number(evidence.notificationAuthorityRevision || 0)) return false;
    const context = {
      channelID, viewKey, activationID: current.activationID, evidence,
      messageCurrent: owner.historyStatus.messageCurrent,
      presentationRevision: owner.historyStatus.presentationRevision,
    };
    confirmation = queuePresentedConfirmation(confirmation, context, presentedBoundary);
    let delivered = false;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const next = nextNotificationConfirmation(confirmation);
      confirmation = next.state;
      confirmationRef.current = confirmation;
      if (!next.event) return delivered;
      const accepted = owner.markNotificationsRead?.(next.event, Object.freeze({
        viewKey: next.event.viewKey,
        activationID: next.event.activationID,
      }));
      const confirmed = accepted !== false && accepted != null;
      confirmation = settleNotificationConfirmation(confirmation, next.event, confirmed);
      confirmationRef.current = confirmation;
      if (!confirmed) return false;
      delivered = true;
    }
    return delivered;
  }, [channelID, committedOwnerRef, controller, domEvidence, viewKey]);

  useEffect(() => {
    if (confirmationRef.current.pending) acknowledgePresented();
  });

  return acknowledgePresented;
}
