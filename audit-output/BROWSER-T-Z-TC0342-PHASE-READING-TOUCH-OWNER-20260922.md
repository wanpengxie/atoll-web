# Browser T–Z — TC0342 ordinary browsing touch successor

## Baseline alignment

- **Baseline:** `fae8b70:tests/browser/post-entry-upward-jump-stage2.spec.js:410`
- **Old user contract:** after a channel is in browsing mode, an ordinary
  touch gesture stays with the active reading owner, moves toward older visible
  history, and does not return to following or leave the active surface blank.
- **Current owner:** the existing Timeline/Reading active layer. No product,
  vendor, protocol, fixture, or scroll-writer code was changed.

The historical test used private diagnostics and compared implementation
`scrollTop` direction. The current public owner exposes a different
`conversation-list` geometry, so the successor preserves the observable
contract using only the rendered timeline/stack/list attributes and row
geometry. It first proves the channel is publicly `following`, with one
active list and a painted anchor row. Each real upward wheel then proves the
settled handoff as `timeline = stack = list = browsing`, one active layer/list,
stable activation/root identity, and painted rows. The first handoff retains
the same anchor row and constrains its geometry movement to the real wheel
budget; subsequent wheel windows move monotonically toward lower history row
identities. During the real touch gesture, the first move retains a common
visible row within the gesture budget, and the completed gesture remains
browsing on the same active surface while moving to an older history row. No
private diagnostic, scrollTop, or internal owner oracle is asserted.

## Reservation and uniqueness

- **Reservation base:** `8f4090e7172f210e6a22037ce26b6dc2e28b1010`
- **Reservation commit:** `5d895955fbe30b22aa857e0656aff795f61ae389`
- **Current rework base:** `73413e2`
- **Worktree:** `/tmp/atoll-web-tc0342-rework-73413e2` (detached)
- TC0340 is already integrated and TC0341 is separately reserved by N–S; this
  packet covers only ordinary browsing touch. Space, SZ212, and SZ215 domains
  are outside this packet.

## Public successor

`tests/browser/tc0342-phase-reading-touch-owner.spec.js` resets the delayed
deep-history scenario with the fae seed, enters `c0.project`, and asserts:

1. the public pre-wheel state is `following`, with one active layer/list and a
   visible anchor;
2. each real upward wheel settles to one active `browsing` list whose public
   mode attributes agree and whose history window moves older;
3. the wheel handoff retains the same anchor identity and bounded geometry,
   then the first real touch move retains a common visible row within its
   geometry budget;
4. the completed touch remains `browsing` on the active surface and moves to
   an older history row; and
5. no private diagnostic or internal scroll-owner oracle is used.

## Verification

- **Chromium:** `ATOLL_TEST_WEB_PORT=15488 ATOLL_TEST_MOCK_PORT=19488 npx playwright test tests/browser/tc0342-phase-reading-touch-owner.spec.js --repeat-each=5 --workers=1` — **PASS 5/5** (38.1s).
- **Build:** `npm run build` — **PASS** (4,306 modules; existing chunk-size advisory only).
- **Scope:** test and audit files only; no product changes, skip deletion, or
  assertion-threshold weakening.
