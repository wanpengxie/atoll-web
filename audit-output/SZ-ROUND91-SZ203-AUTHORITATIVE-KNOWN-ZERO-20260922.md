# SZ-203 authoritative known-zero public owner

Date: 2026-09-22

Base: `1cef84fdca12add9cf2041bba1d1ad9cdf95177f`

## Contract

| item | decision |
| --- | --- |
| User capability | When the current attached history generation and sync receipt prove a channel has no rows, the user receives a settled empty projection instead of a recovery prompt. |
| Invariant | `headSeq === 0`, current generation/message authority, local Replica readiness, and fulfilled sync interest jointly produce `empty-known`; no history recovery request is emitted. |
| Public owner | `useConversationProjection` → `useHistoryConsumer` viewport and `projection.presentation.rows`. |
| Scope boundary | No private hook state, old scheduler, compatibility alias, second store, product source, vendor, package, or lockfile change. |

## Evidence

`tests/sz203-authoritative-known-zero-public-owner.test.jsx` supplies an empty public Replica with generation `3`, current message authority, `headSeq: 0`, local readiness, and a fulfilled sync receipt (`interestRevision: 4`, `fulfilledRevision: 4`, `targetHead: 0`). It observes:

- `viewport.availability === 'empty-known'` and `emptyReason === 'channel'`;
- `viewport.initializing === false` and `restorePending === false`;
- an empty public Presentation (`projection.presentation.rows === []`);
- no history request, including after an unchanged status re-publication.

This is distinct from SZ-178/SZ-202: those contracts recover a missing bookmark or preserve readable rows during recovery. SZ-203 covers the authoritative zero-row case, where recovery is not needed.

## Result

Focused Vitest: **PASS** (1 file, 1 test).

The current public owner satisfies the contract. No product fix or regression hand-off is required.
