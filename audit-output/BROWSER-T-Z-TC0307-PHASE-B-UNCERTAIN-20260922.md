# Browser T–Z audit — TC-0307 / B-BR-07a uncertain-window convergence

## Delivered successor

- **Legacy baseline:** `fae8b70:tests/browser/phase-b.spec.js:348` — receipt and
  feed are both unconfirmed, the public send enters `uncertain`, and the
  reconnect/ledger path converges without creating a second business message.
- **Exact base:** `4746eed599b88555ddf8255f53ebaaa4f246e335`
  (`test(sz216): cover following viewport count receipt boundary`).
- **Worktree:** detached `/tmp/atoll-web-tc0307-successor-4746eed`.
- **Successor:** `tests/browser/tc0307-phase-b-uncertain.spec.js`.
- **Scope:** this spec and this audit only; no product, mock fixture, vendor,
  package, screenshot, or existing assertion was changed.

## Public contract and oracle

The spec drives the real Composer send against the existing `message-flow`
scenario, then injects one public receipt drop and a bounded feed delay for
`agent.ask`.  It observes only public DOM and websocket frames:

1. `.channel-notice` visibly reports `发送结果待确认` (the submission-scoped
   uncertain projection).
2. The same public notice is cleared after the exact landed ledger request is
   observed; the old private `.composer-status.state-uncertain` is also absent.
3. The message text appears exactly once in the public `频道动态` region.
4. Every matching `agent.ask` submit has one stable business `message_id` and
   a present, equal `payload.origin`; one physical retry is allowed because the
   receipt was intentionally dropped, but no more than two attempts may occur.
5. Exactly one matching live feed row lands, no downstream frame reports
   `idempotency_conflict`, and the browser has no `pageerror`.

The response rows in this existing fixture can be broadcast before reconnect
and therefore are not the B-BR-07a terminal oracle. Requiring a particular
`PONG` body would conflate response replay with the legacy receipt/feed
convergence contract.  The exact terminal here is the public landed request
fact plus clearing of its submission-scoped uncertain notice.

## Uniqueness

The current base has no tracked `tc0307-phase-b-uncertain.spec.js` or TC-0307
audit. Existing `e7651cb`, `8120b96`, and `74ffbaa` are reservations on
non-main candidate refs and are not ancestors of this base. Existing
`tc0304`/`tc0306` cover receipt/feed ordering and receipt-lost/feed-landed
paths respectively; this successor is limited to the both-unconfirmed
uncertain window.

## Verification

| Check | Result |
| --- | --- |
| Chromium public successor, `--repeat-each=3 --workers=1` | **PASS 3/3** |
| `npx vitest run tests/submission-tc0307-stable-origin.test.jsx` | **PASS 5/5** |
| `npm run build` | **PASS** |

The browser run used isolated ports (`15240`/`18940`) and completed with no
page errors.  The only server-side console output was the intentional mock
receipt-drop reconnect warning.
