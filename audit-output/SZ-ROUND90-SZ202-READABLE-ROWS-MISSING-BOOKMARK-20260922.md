# SZ-202 readable rows with a missing bookmark

Date: 2026-09-22

Base: `871ca7e9f6a2bc4b42e97f528b1c0ed9d1eb9af2`

## Contract

| item | decision |
| --- | --- |
| User capability | While a saved browsing bookmark is not present in the current projection, the history owner continues recovery supply without hiding already readable rows behind an initialization state. |
| Invariant | The current projection remains `readable` and `viewport.initializing` remains false when at least one readable row is installed; exactly one typed `restore-reading` / `initial-view` blocking request targets the immutable bookmark. |
| Public owner | `useConversationProjection` → `useHistoryConsumer`; public evidence is the returned `viewport`, `projection.presentation.rows`, and the history request port. |
| Scope boundary | No second store, private state inspection, old scheduler path, compatibility alias, product source, vendor, package, or lockfile change. |

## Evidence

`tests/sz202-readable-rows-missing-bookmark.test.jsx` installs one public Replica row (`readable-row`) and a browsing session whose saved bookmark (`missing-bookmark`, sequence 3) is absent. The test observes:

- one `restore-reading` request with `intent: 'initial-view'`, blocking urgency, and the exact public bookmark coverage;
- `viewport.availability === 'readable'` and `projection.presentation.rows === ['readable-row']` while recovery is pending;
- `viewport.initializing === false` while `viewport.restorePending === true`, distinguishing usable presentation from ongoing supply;
- the same source facts re-render without a duplicate request.

This is distinct from SZ-178: SZ-178 covers a semantic-view switch with no installed rows and therefore expects blocking initialization; SZ-202 covers an already-readable projection during bookmark recovery.

## Result

Focused Vitest: **PASS** (1 file, 1 test).

The current owner already satisfies the contract. No product change is required; this is a public-owner closure rather than a regression hand-off.
