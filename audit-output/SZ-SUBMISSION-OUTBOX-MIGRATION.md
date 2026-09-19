# S–Z submission/outbox migration ledger

Baseline: `fae8b70` (`tests/submissions.test.js`, 4 cases; `tests/submission-outbox.test.jsx`, 16 cases).  The old imports resolve to deleted `src/model/submissions.js` and `src/app/hooks/useSubmissions.js`; no compatibility module was restored.  Current public owners are `src/model/outbox-store.js` and `src/ui/composer/useComposerSubmissionRuntime.js`.

Focused evidence: `npx vitest run tests/submission-outbox-current.test.jsx --reporter=verbose --pool=threads --maxWorkers=1` → **8/8 passed**.  The test file exercises the public runtime/store boundary only; it does not export or mock private runtime helpers.

## Case decisions

| Baseline case | User capability / invariant | Current owner and evidence | Disposition |
|---|---|---|---|
| submissions: stable client id removed only when feed lands | A send remains recoverable under receipt/feed reordering and is removed only on a canonical landed fact | `useComposerSubmissionRuntime.reconcileFeed` + `outbox-store.remove`; current test “persists a stable queued message id…” | **Migrated, green** |
| submissions: transmitting restores as uncertain; closed/timeout differ from forbidden | Reload must not claim an in-flight send succeeded; transport uncertainty is distinct from definitive refusal | Runtime’s public `pending`/`retry` path owns this; the `restoredSubmission` mapper is private and no stable mount fixture exists yet | **待建；未删** |
| submissions: never-transmitted offline item restores queued | Offline user intent survives reload as a queued durable frame | `outbox-store.putMany/restore`; covered by the stable queued-id test | **Migrated, green** |
| submissions: explicit recovery states clear foreign leases and do not regress accepted work | A second tab cannot steal a live lease; accepted work cannot be downgraded by stale recovery | `outbox-store.acquireLease/releaseLease/patch`; current lease and transmit-state tests | **Migrated, green** |
| outbox: suspended candidate render cannot publish transport authority | React candidate rendering must not replace the committed send owner | `useComposerSubmissionRuntime` authority is installed in a layout effect; current stable-callback test covers committed execution but not a Suspense harness | **待建；未删** |
| outbox: stable Composer callback reads execution-time authority | A click held by an old render must consult current wire/access authority | `useComposerSubmissionRuntime.send`; current “reads transport authority…” test | **Migrated, green** |
| outbox: disconnected send accepts locally and auto-transmits after reconnect | User intent is durable offline and is sent once when transport becomes current | `outbox-store` durable queued→transmitting→accepted path is covered; automatic reconnect hook integration remains unmounted/harness-sensitive | **部分迁移；自动重连待建** |
| outbox: unknown access is not durably queued, then succeeds after membership | No durable send without confirmed channel membership; later confirmation permits it | Runtime `captureRequestOwner`/access gate; current membership transition test | **Migrated, green** |
| outbox: retryable unavailable refusal stays queued and reuses id | Temporary service unavailability must not lose or duplicate the intent | Runtime currently covers closed→uncertain and retry; `channel_unavailable`/access-obligation branch still needs a focused case | **部分迁移；待建** |
| outbox: revoked membership rejects queued work | Revocation is a definitive user-visible refusal, not an automatic retry | Current owner is runtime access assessment; no stable queued-revocation fixture in this migration | **待建；未删** |
| outbox: retired channel rejects queued work | Retired channel cannot revive a durable send | Runtime access assessment; no stable retired-channel fixture in this migration | **待建；未删** |
| outbox: access change during in-flight send does not downgrade accepted receipt | Settlement uses the captured owner and does not rewrite a later accepted fact | Runtime `REQUEST_PHASE.settle`; integration fixture not yet rebuilt | **待建；未删** |
| outbox: retired channel cannot durably accept a new send | A stale member relationship cannot bypass channel retirement | Runtime `REQUEST_PHASE.persist`; no focused current-owner test yet | **待建；未删** |
| outbox: repeated uncertain results do not hot-loop one durable id | One attempt/lease at a time; reconnect must not create concurrent retransmits | `outbox-store` lease owner and runtime retry path; current test proves lease exclusion, not reconnect loop | **部分迁移；待建** |
| outbox: definitive rejection remains visible and is not self-retried | User sees rejection and chooses retry explicitly | Runtime failure mapping + explicit `retry`; current rejection test | **Migrated, green** |
| outbox: feed before receipt is one landed attempt | Canonical feed arrival wins the race and suppresses retransmit/duplicate cleanup | Runtime `reconcileFeed` + store removal; current landed-feed test covers durable removal before later reads, not a held receipt promise | **部分迁移；待建** |
| outbox: receipt before feed is one attempt | Receipt acceptance remains visible until feed lands, without a second submit | Runtime `transmit`/accepted state; no current held-feed fixture yet | **待建；未删** |
| outbox: landed id racing principal hydration is not resurrected | Feed acknowledgement is durable across hydration ordering | Runtime `reconcileFeed` requires current producer owner; no current hydration-race fixture yet | **待建；未删** |
| outbox: legacy landed id racing migration is not resurrected | Existing local data must not duplicate a canonical feed fact | Old `saveSubmissions` migration owner was deleted; restoring it would violate the no-legacy-store rule. Current v2 equivalent is covered only for canonical removal | **待决；需 root 产品/数据迁移裁定** |
| outbox: immutable frames do not consume a newer draft | Sending an older snapshot must not erase newer user edits | `outbox-store.acceptDraft`; current “does not consume a newer draft…” test | **Migrated, green** |

## Boundary and unresolved work

- No production files, package/vendor files, old stores, compatibility exports, or private exports were changed.
- The eight green tests are behavior tests against the current public owners.  The thirteen `待建/部分迁移` rows remain explicit; none was deleted or weakened to make the focused suite green.
- The legacy migration row is intentionally not “fixed” in the test layer.  Root must decide whether legacy persisted submissions are still a supported user capability and, if so, assign a current data-migration owner before a test can be written.
