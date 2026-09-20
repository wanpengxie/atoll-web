# A–D AD-097 — fast reselect handoff recovery (2026-09-20)

This case was audited from exact `2bf517357eaf9e7b5a69e8a5d5cc2a172237b0a5`
(`2bf5173`) in the independent worktree
`unit-a-d/ad097-fast-reselect`. AD-099 was intentionally not changed or
reclassified. No product source, session store, vendor, package, lockfile, or
private API was touched.

## Case ledger row

| Case | User capability | Invariant | Current public owner | Baseline setup/action/result | Current result/disposition |
|---|---|---|---|---|---|
| AD-097 | While channel B is still pending, the user can rapidly reselect the already committed channel A; the old pending handoff is cancelled and the current-channel terminal entry is usable again. | `navigation.activeChannelId` remains the sole committed identity; the latest presentation handoff owns the pending gate; a stale B request must not replay A's canonical navigation command or let old DOM consume an action. | `WorkspaceLayout` owns the presentation-only `pendingChannelSelection` gate and terminal command readiness; the `navigation.select` callback remains the canonical selection port. | Fae `fae8b70:tests/app-shell-terminal-split.test.jsx:98-110` rendered committed `c0`, selected `c1`, immediately selected `c0`, expected terminal disabled during the handoff, expected old `onSelect` calls `['c1','c0']`, then expected terminal reopening on `c0`. The user-visible result was cancellation and safe return to `c0`; the second callback expectation was an old owner side effect. | **PASS after fixture migration.** Current `WorkspaceLayout` clears the presentation pending fact when the selected id is already committed, leaves the canonical `select` calls as `['c1']`, and re-enables the terminal entry. Round23's stale `['c1','c0']` assertion was replaced by that public cancellation observable; no product change was needed. |

## Fae path and current owner

The historical path was:

```text
ChannelList c0 (committed)
  → click c1
  → parent has not committed c1; old terminal command is gated
  → immediately click committed c0
  → pending handoff is superseded/cancelled
  → terminal entry is usable for c0 again
```

The fae test also asserted a second `navigation.onSelect('c0')`. That callback
count is not the user capability: c0 was already the committed identity, so a
second canonical navigation command would be a duplicate side effect. The
current public contract preserves the safe terminal state and cancellation,
while the shell handoff owner handles the reverse input locally.

Current implementation evidence:

- `src/app/WorkspaceLayout.jsx:136-156` documents
  `navigation.activeChannelId` as the sole committed selection authority and
  keeps `pendingChannelSelection` as a presentation-only gate.
- `src/app/WorkspaceLayout.jsx:157-193` routes a new target to the canonical
  `navigation.select` port; when the target equals the committed id, it clears
  the matching pending origin and returns without replaying `select`.
- `src/app/WorkspaceLayout.jsx:146-150,264-278` derives terminal readiness from
  the pending presentation handoff, so the old terminal cannot consume an
  event while B is still uncommitted and becomes usable once the reselect
  cancels that gate.

No additional session state or navigation authority was introduced.

## Public regression evidence

The current owner already had three green public contracts and one stale
Round23 fixture. The Round23 case was migrated without deleting or skipping it:

- `tests/blocked-round15-terminal-owner.test.jsx:152-160` — current AD-097
  contract and terminal re-enable assertion.
- `tests/blocked-round18-public-owner.test.jsx:70-79` — current handoff owner
  contract.
- `tests/blocked-round25-public-owner.test.jsx:538-549` — current public-owner
  contract with explicit `['c1']` canonical call proof.
- `tests/blocked-round23-public-owner.test.jsx:198-211` — migrated from the
  old `['c1','c0']` callback-count oracle to the current public cancellation
  result (`['c1']` and enabled terminal entry).

Focused verification on exact `2bf5173` after the test-only migration:

```text
npx vitest run \
  tests/blocked-round15-terminal-owner.test.jsx \
  tests/blocked-round18-public-owner.test.jsx \
  tests/blocked-round23-public-owner.test.jsx \
  tests/blocked-round25-public-owner.test.jsx \
  --reporter=dot -t '\\[AD-097\\]'

Test Files  4 passed (4)
Tests       4 passed | 74 skipped (78)
```

The jsdom run emitted the existing Canvas `getContext()` not-implemented
notice; it did not affect the four passing AD-097 cases. No browser run was
needed because there was no product red after the public fixture was aligned
to the current owner; the requested product-red browser path was therefore not
entered.

## Disposition

AD-097 is **PASS/current public owner**. The only changed test assertion
removed an obsolete duplicate-navigation side effect and added the existing
public terminal readiness evidence. AD-099 remains untouched and unresolved in
its own owner contract; it is not included in this disposition.
