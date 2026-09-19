# A–D Round 21 public-owner regression and cursor evidence (2026-09-20)

This packet continues the case-level ledger at
[`RESTORE-CASES-A-D-20260919.md`](./RESTORE-CASES-A-D-20260919.md). It covers
the five Feed/Replica product gaps called out in Round 20 and the next fifteen
cursor cases, each as an independent public-owner assertion. The new test file
is [`tests/blocked-round21-public-owner.test.jsx`](../tests/blocked-round21-public-owner.test.jsx).

The five priority cases are ordinary red assertions, not `it.fails`, so their
failure is an inspectable product-regression packet. The ten green cursor
cases are promoted to PASS. The ten red cases remain `BLOCKED` in the ledger
pending their existing owner; no expected-fail result is counted as recovery.

## Focused verification

Command:

```text
npx vitest run tests/blocked-round21-public-owner.test.jsx --reporter=dot
```

Observed result on HEAD `a3963f6`:

```text
Test Files  1 failed (1)
Tests       10 failed | 10 passed (20)
```

Green cases: AD-277, AD-278, AD-282, AD-283, AD-285, AD-286, AD-287,
AD-290, AD-293, and AD-294. Ordinary red cases: AD-157, AD-158, AD-167,
AD-170, AD-182, AD-284, AD-288, AD-289, AD-291, and AD-292.

## Case evidence

| ID | User capability | Invariant | Current public owner and action | Current result and disposition |
|---|---|---|---|---|
| AD-157 | Old-boot cache completion cannot reappear as a notification after world replacement. | Boot/Replica epoch fences cache admission. | `ChannelFeedRuntime.enqueue` with source `cache`; replace boot, then enqueue a c1 row and inspect `stateFor().rows`. | **RED**: row 3 is accepted after the replacement. First boundary is `enqueue` plus Replica. Keep BLOCKED as a CAPABILITY_GAP. |
| AD-158 | In-flight hydration cannot land after its channel grant is revoked. | Current attach grant set fences cross-channel cache admission. | `ChannelFeedRuntime.setHistoryGrants` removes c1, then public `enqueue` submits a c1 cache row. | **RED**: revoked row remains in c1 Replica. Keep BLOCKED as a CAPABILITY_GAP. |
| AD-167 | Revoked active channel is not probed and a later grant resumes one pending interest. | Grant generation owns `refreshChannel` probe admission. | `ChannelFeedRuntime.refreshChannel` with a public `channelMeta` spy across revoke and regrant. | **RED**: `channelMeta` is called while revoked. Keep BLOCKED as a CAPABILITY_GAP. |
| AD-170 | Forbidden convergence removes cached access visibility. | Access revoke and materialized Replica projection converge at one owner. | Enqueue a cached c0 row, reject public `channelMeta` with `forbidden`, inspect c0 state. | **RED**: one row remains materialized. Keep BLOCKED as a CAPABILITY_GAP. |
| AD-182 | Terminal-first history remains closed after trim and older request pagination. | Trim may discard body but must carry compact terminal closure. | Public `loadHistory`, `enqueue`, and `pageEnd` through ChannelFeedRuntime/Replica. | **RED**: terminal row 460 remains after suffix pressure. Keep BLOCKED as a CAPABILITY_GAP. |
| AD-277 | More than one arrival window stays exact until Timeline consumes it. | Arrival revisions and explicit receipts are monotone and replayable by row identity. | Public `state.arrivalReceipts.attachTimelineConsumer`, `timeline`, and `dispatch`; commit 1,100 live rows. | **PASS**: revisions 1–1,100 are exposed and one receipt clears the journal. |
| AD-278 | Repeated root arrivals survive partial acknowledgement and a new tail. | Root identity is stable across overflow and partial receipts. | Public Timeline receipt port; commit a root plus 1,100 child arrivals, ack 50, then the full head and add a tail. | **PASS**: the root backlog remains through partial ack, drains at the full receipt, and the tail is visible. |
| AD-282 | Feed resume head advances but does not rewind, independently from notification ack. | Physical feed head and notification high-water are separate public facts. | Public `historyFor` after live seq 8 then stale seq 3. | **PASS**: `headSeq` is 8 and notification high-water remains 0. |
| AD-283 | Same-world notification high-water persists; a replacement boot baselines at attach head. | Principal plus boot is the notification authority epoch. | Public `acknowledgeNotifications` then recreate Feed with same and replacement boot. | **PASS**: same world restores 1; replacement world starts at its explicit attach head 1. |
| AD-284 | Acknowledging visible identities does not clear an unvisited sibling. | Sparse identity receipt must not collapse into unconditional high-water. | Public `acknowledgeNotifications` at frozen boundary 3 for three sibling roots, then `unreadFor`. | **RED**: high-water clears all three and unread is 0 instead of 1. Keep BLOCKED as a CAPABILITY_GAP. |
| AD-285 | Physical read position is separate while system and self rows are excluded from notification count. | Read cursor and notification projection do not overwrite each other. | Public `markRead` at seq 2 and `unreadFor` over two related, one system, and one self row. | **PASS**: physical mark returns 2 and only the two related roots count. |
| AD-286 | Feed-window capping does not rewind a cache-independent read position. | Resume head and physical read cursor are independently monotone. | Public `markRead` at 48, same-world grant head 33, then mark at 33. | **PASS**: head remains 48 and mark returns the retained 48 boundary. |
| AD-287 | A new attach head does not move an older read boundary backwards. | Attach baseline fills only an empty read cursor. | Public mark at 120, reattach head 130, then mark at physical 100. | **PASS**: the retained result is 120. |
| AD-288 | Persisted reads are used only after explicit principal and ledger-world authority. | Cursor persistence is scoped by the active authority tuple. | Seed the public cursor storage key, prepare the same principal/world, and inspect `historyFor`. | **RED**: stale notification high-water 999 is restored for head 40. Keep BLOCKED as a CAPABILITY_GAP. |
| AD-289 | Restored physical and exact facts are clamped to the current channel head. | Restore cannot make future rows appear already acknowledged. | Seed public cursor storage at 999, attach current head 40, inspect `historyFor`. | **RED**: high-water remains 999 above head 40. Keep BLOCKED as a CAPABILITY_GAP. |
| AD-290 | A visible root receipt leaves an unshown sibling unread. | Frozen public boundary only covers the observed prefix. | Public `acknowledgeNotifications` at boundary 1 followed by `unreadFor`. | **PASS**: sibling root remains `{ related: 1, total: 1 }`. |
| AD-291 | Related @me unread and weak all-message count remain distinct. | Notification projection must not collapse two count semantics into one root set. | Public `unreadFor` with a conversation between two other actors. | **RED**: both counts are 0; the weak all-message count is lost. Keep BLOCKED as a CAPABILITY_GAP. |
| AD-292 | Agent self-audience work wakes the user only when terminal user content exists. | Queued/processing/progress are not notices, but readable terminal content is. | Public Feed/Replica rows for agent self-audience request, queued, processing, and completed content. | **RED**: terminal content still yields total 0. Keep BLOCKED as a CAPABILITY_GAP. |
| AD-293 | Browser UI operation streams and system narration never become rail notifications. | Rail consumes readable conversation facts only. | Public `unreadFor` after UI event and system event ingress. | **PASS**: both rows produce `{ related: 0, total: 0 }`. |
| AD-294 | A human-owned request entering processing does not create a new notification. | Self-owned request and provisional lifecycle are excluded. | Public Feed/Replica request plus processing response, inspected through `unreadFor`. | **PASS**: result remains `{ related: 0, total: 0 }`. |

## Ledger and blocked quantification

The ten green cases move from BLOCKED to PASS. The ten ordinary red cases are
kept BLOCKED, rather than converted to expected-fail or declared obsolete. The
ledger is therefore **304 PASS / 0 REGRESSION / 61 BLOCKED**. The 10 red
assertions are independently reproducible product-gap evidence; they are not
counted as migration completion.

The 61 remaining blocked rows are quantified as:

| Category | Count | Round 21 change |
|---|---:|---|
| OWNER_MISSING | 12 | unchanged |
| FIXTURE_MISSING | 34 | down from 49 after ten cursor cases gained one-to-one public fixtures; the remaining cursor fixture rows are AD-295–AD-304 and AD-306–AD-307 |
| CAPABILITY_GAP | 15 | up from 10; AD-284, AD-288, AD-289, AD-291, and AD-292 now have ordinary red public-owner reproductions |
| **Total** | **61** | no row deleted, skipped, or judged obsolete |

## Boundary audit

This packet changes only `tests/blocked-round21-public-owner.test.jsx`, this
report, the A–D ledger, and the two A–D verification reports. It does not
modify Feed/Replica source, Workspace, Reading, Outbox, vendor, package
manifests, lockfiles, or production exports. It does not use the deleted
`src/model/cursors.js` helper, private fields, compatibility APIs, or
expected-fail declarations. Product-gap rows stop at their first public owner
boundary and remain available for the responsible owner to fix.
