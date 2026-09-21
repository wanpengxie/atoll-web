# S–Z round 105 — SZ-220 committed presentation owner

## Reservation and scope

- **Case:** `SZ-220`, the numeric baseline whose user capability is a
  committed presentation choice remaining on its committed channel while a
  different channel render is suspended, without taking Reading control.
- **Current base:** `73413e2b6e6734e8463b5a0b38a386d0b0e789f0`.
- **Branch:** `unit-s-z/sz220-current-73413e2`.
- **Worktree:** `/home/xiewanpeng/.atoll/device/daemons/local-device/channels/c0.dev/atoll-web-sz220-current-73413e2`.
- **Files in scope:** the test below and this audit only. There is no product,
  protocol, package, lockfile, vendor, skip, compatibility, or private-export
  change.

The reservation was made only after checking the S–Z ledger, RESTORE records,
and all current refs. SZ-217 is already represented by the SZ-209 public
tail-intent/paint contract; SZ-218 and SZ-219 are represented by the current
SZ-218 presence/visibility contract. SZ-221, SZ-222, SZ-225, and SZ-231 remain
implementation-detail rows with no current public user owner and were not
claimed. SZ-189, SZ-212, and SZ-215 were explicitly excluded as in-progress
domains.

## User capability and current owner

The deleted `<Timeline>`/`LegendMessageList` path is not restored. The current
public composition is:

`ConversationSurface` → `useTimelinePreferences` →
`ReadingContainerHandoff`/the committed Reading viewport.

The surviving user-visible presentation choice is folding a rich message body.
The invariant is that a suspended candidate channel cannot receive the choice,
and changing the committed row's presentation cannot create a native Reading
navigation action or replace the committed reading DOM. `useTimelinePreferences`
owns the durable `foldOverrides` write; the Reading viewport exposes the
content-anchor port and remains the sole reading authority.

The older fixture asserted the same authority boundary through deleted
`Timeline` internals and a process-details affordance. This successor exercises
the surviving public presentation choice through `ConversationSurface`; it does
not restore the deleted fixture or infer an old private helper.

## Evidence

The new public-owner test is
`tests/sz220-committed-presentation-owner.test.jsx`.

It renders committed channel `c0`, starts a React suspended candidate for `c1`,
and clicks the real current renderer's `展开全文` affordance while `c0` remains
committed. It proves:

1. the c0 choice is written through the public `viewSessions.writeConversation`
   port as `foldOverrides: [['committed-work:body', true]]`;
2. no c1 write occurs while its candidate is suspended;
3. the same public reading container remains connected in `following` mode;
4. no native `beginNavigation` call is made; only the public content-anchor
   port is observed.

No private state, underscored field, internal store, or compatibility alias is
asserted.

## Verification

- Focused: `npm test -- tests/sz220-committed-presentation-owner.test.jsx --run --reporter=verbose` — **1 passed**.
- Adjacent: `npm test -- tests/sz220-committed-presentation-owner.test.jsx tests/timeline-preferences.test.jsx tests/waiting-layout.test.jsx tests/following-tail-list.test.jsx --run --reporter=dot` — **4 files / 17 tests passed**. The existing row-error test intentionally logs its rejected render through the public retry boundary; it still passes.
- Build: `npm run build` — **passed** (Vite emitted only the existing chunk-size warning).

**Disposition:** one unique SZ-220 current-owner successor, test-only,
candidate GREEN. No product repair is requested.
