# SZ-178 — semantic view switch restores an uninstalled bookmark

Date: 2026-09-21  
Base: `5680d0862e6d2654e53a5f70a3efb9c79ebb3136`  
Owner: `useConversationProjection` → `useHistoryConsumer` viewport; the
`viewSessions` activation is the durable view-session boundary.  
Test: `tests/sz178-semantic-view-bookmark.test.jsx`

## Contract

The user can switch semantic views in one channel and continue from the
saved reading bookmark of the newly selected view. If that bookmark is not
in the current Presentation projection, the current owner must expose
`initializing`/`restorePending` and issue one blocking `initial-view` demand
with the exact `{messageID, seq}` visible-coverage target.

The contract is about the user-visible projection and the public viewport
port. It does not inspect controller refs, internal stores, or retired
`useReadingSession` APIs.

## Evidence

The test starts in `c0:mine` with an installed row and a following session;
the public viewport settles initialization without issuing a history demand.
It then rerenders the same channel as `c0:all`, where the public
`viewSessions.readView` returns browsing bookmark
`saved-all-row`/sequence `3`, while the current Presentation has no matching
row. The new public viewport gets a new activation, reports
`initializing === true` and `restorePending === true`, and calls the injected
public history request exactly once with:

```text
intent: initial-view
urgency: blocking
targetSeq: 3
requiredVisibleCoverage: { messageID: saved-all-row, seq: 3 }
```

A subsequent rerender with unchanged source facts does not duplicate the
demand. The assertions use only `viewport` state and the injected public
request port; no private controller field or scheduler oracle is read.

## Result

Focused Vitest: PASS (1 test). No product source was changed. This closes
the current public-owner proof for SZ-178 without restoring the retired
`useReadingSession` path or adding a compatibility layer.
