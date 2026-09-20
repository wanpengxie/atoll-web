# E-H TC0225 scope/filter handoff audit

## Case contract

- Old behavior: while browsing a deep-history row, changing the public scope or participant filter leaves and later returns to the same row at the same viewport offset; an explicit latest action or Composer send-start is a user takeover and must not restore that old row afterward.
- User capability: browse history, activate a public scope/participant filter, return to the source view, and either preserve the browsing position or explicitly choose latest/send.
- Invariants: one `useConversationProjection` Reading owner; cross-`messageListKey` continuity is an ephemeral successor handoff only; filtered views never receive a lease for a missing source row; the existing `position-row` command remains consumed by the sole Vendor writer; wheel, channel, generation, and physical-root changes revoke authority; no durable bookmark, second store, or compatibility path.
- Current public owner: `ConversationSurface` owns the public scope/filter controls and Composer reading-intent port; `useConversationProjection` owns the session, handoff ref, and latest cancellation; `VendorListExecutor` remains the only DOM position writer.

## Current proof

The source handoff records the source row, viewport offset, source activation/input/revision, generation, and intermediate view in a projection-local ref. It is accepted only after the source row is present in the committed return projection and is translated into the existing typed `position-row` lease. An explicit latest action or Composer send-start marks that ref with an ephemeral terminal flag until the source view returns; the source owner then consumes the existing bottom command and clears the flag, so a reused physical root cannot leave the old row visible. Native navigation, wheel input, root replacement, and rejected position leases clear the ref immediately, so a late layout effect cannot revive the old row.

The strict browser coverage keeps the original restoration contract and adds the takeover counterexample: source browsing → participant filter → Composer send-start → return to the source view. After source reactivation settles, the existing Reading owner has returned the source viewport to the physical tail (`scrollHeight - clientHeight - scrollTop <= 1`) and the captured old row is not visible. The existing jump-latest ownership suite covers the public latest button path.

## Verification

- `npx playwright test tests/browser/f7-history-water-baseline-0222-0226.spec.js --grep 'TC0225' --repeat-each=20`: **40 passed** on the `b4b3bd1 + e395aab` integration baseline (7.2 minutes; both restore and send-start takeover runs assert source tail and old-row non-restoration).
- `npx playwright test tests/browser/history-underfill-lifecycle.spec.js --grep 'cancelled older page cannot continue'`: **1 passed** (TC0223 late page/paint cancellation browser proof).
- `npm test -- --run tests/tc0223-cancel-late-settle.test.jsx tests/e-h-tc0216-continuation-lineage.test.js`: **6 passed**.
- `npx playwright test tests/browser/jump-latest-ownership.spec.js --grep 'browsing reader jump-latest' --repeat-each=3`: current a5b111a baseline has a pre-click `scrollTo` (`writesBeforeClick === 1`, expected `0`); this is the separate jump-latest owner and reproduces unchanged on a clean a5b111a worktree. It is not counted as a TC0225 failure or changed here.
- `npm test -- --run tests/f6-composer-isolation.test.jsx`: **11 passed**.
- `npm run build`: **passed** (existing Vite chunk-size warning only).
- `git diff --check`: **passed**.

## Scope boundary

Only the existing projection/ConversationSurface owners, this case's browser test, and this audit are changed. No vendor package, package manifest, lockfile, deleted/skipped/weakened test, private export, durable bookmark, second store, or second DOM writer is introduced.
