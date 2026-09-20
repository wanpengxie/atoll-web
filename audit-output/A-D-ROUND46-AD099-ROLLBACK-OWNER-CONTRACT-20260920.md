# A–D Round 46 — AD-099 invalid-target rollback owner contract (2026-09-20)

Round 46 replays AD-099 through the baseline's real three-state handoff. The
previous Round 45 fixture asserted `c0` while the directory had only published
the provisional invalid `c1` identity; that skipped the public rejection
boundary and reported a red result too early. The migrated case now records
the intermediate gate and the owner-published fallback separately. No product
source or new navigation API is added.

## Current public owner contract

| Boundary | Public fact | Required observable invariant |
|---|---|---|
| Navigation authority | `useChannelNavigation` is the sole owner of `activeChannelId` and derives `activeChannel` from the current access/directory rows. Its `select(target)` is the user request; directory validation may publish the target before rejecting it. | A provisional target must not be treated as a readable committed channel. `activeChannelId` and `channel.id` may be temporarily incoherent only at the rejection boundary, and no stale content/command may become usable. |
| Shell handoff gate | `WorkspaceLayout` owns only presentation state: the pending `{origin,target}` handoff and the terminal command gate. It consumes the navigation projection and does not synthesize directory rollback. | From committed `c0`, one user click on `c1` calls `navigation.select('c1')` once and disables the old terminal action immediately. |
| Rejection phase | The directory owner publishes `activeChannelId='c1'` with no readable `channel` row. | The shell remains gated (`终端.disabled === true`); it must not focus or expose `c1` content and must not issue a synthetic `select('c0')`. |
| Fallback commit | The navigation owner publishes the last committed identity again (`activeChannelId='c0'`, `channel.id='c0'`). | The shell shows heading `c0`, clears the stale handoff, and re-enables the terminal entry. The only request call remains `select('c1')`; rollback is an authority commit, not a second user selection. |

This contract keeps one selection authority. A `rollback()` helper, a second
shell store, a direct hash write, or a test-only fallback callback would create
an additional owner and is explicitly out of scope.

## Case record and evidence

| Case | User capability | Invariant | Public owner | Baseline setup/action/result | Current result/disposition |
|---|---|---|---|---|---|
| AD-099 | When a selected channel is rejected by the directory, the user returns to the last committed channel and the stale handoff ends. | The authority owner, not the shell, owns invalid-target rollback; the shell keeps stale commands gated until the fallback identity commits. | Navigation authority: `useChannelNavigation`; presentation gate: `WorkspaceLayout`. | Start at committed `c0`; select `c1`; publish provisional `c1` with no channel and keep terminal disabled; then publish fallback `c0`, restore the heading, and enable terminal without a second `select`. | **PASS:** `tests/blocked-round25-public-owner.test.jsx:544-578` proves all three states with the current public projection. Focused combined run at shared HEAD `9cb258d`: **AD-099 1 passed, AD-093 1 failed, 18 other tests skipped**. The former direct `c0` assertion was a fixture-ordering error, not a product regression. |

## Verification

```text
npx vitest run tests/blocked-round25-public-owner.test.jsx \
  --reporter=verbose -t '\\[AD-099\\]'

Test Files  1 passed (1)
Tests       1 passed | 19 skipped (20)
```

The existing Round 18 `it.fails` declaration remains historical evidence only
and is not counted as completion. The ordinary Round 25 declaration is the
single executable AD-099 source; it was corrected to preserve the baseline
provisional-target → fallback-commit sequence rather than adding a duplicate
red test.

The A–D ledger moves from **329 PASS / 0 REGRESSION / 36 BLOCKED** to
**330 PASS / 0 REGRESSION / 35 BLOCKED**. No test was deleted, skipped, or
converted to expected-fail; no product source, private export, compatibility
API, vendor, package, or lockfile changed.
