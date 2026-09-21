# Browser A-F audit — TC-0306 / B-BR-07 receipt-lost feed-landed

## Reservation

- **Legacy baseline:** `fae8b70:tests/browser/phase-b.spec.js` (`B-BR-07 receipt 丢失但 feed 已落账时直接以账本事实完成对账`).
- **Current base:** `4f051f9d4896141396f6a79c1eaeb5bdae16f296` (`refactor/frontend-subtractive-cleanup`).
- **Branch/worktree:** `codex/browser-af-tc0306-4f051f9` / `.tmp-browser-af-tc0306-4f051f9`.
- **Public contract:** when the receipt is lost but the feed has already landed, the user sees the ledger fact as one completed visible message: connection remains `OPEN`, exactly one copy of the submitted text is visible in the conversation, `PONG` is visible, and the composer does not remain in the public `uncertain` state.
- **Fixture:** existing public mock scenario `receipt-lost-feed-landed` (`drop_receipt: true`, feed delay `0ms`, receipt delay `1500ms`). No product or mock change is needed.

## Uniqueness / scope

The A-F claim/report/worktree scan found no existing TC-0306, B-BR-07, or equivalent receipt-lost/feed-landed browser claim. TC-0304 covers ordering with both receipt/feed present; TC-1207 covers receipt-before-feed. Neither proves the lost-receipt ledger reconciliation contract. `tests/browser/tc0306-phase-b-receipt-lost.spec.js` is the only test addition; no source, vendor, package, or existing fixture is changed.

## Planned evidence

Run the dedicated browser contract with real Chromium, `--repeat-each=3`, one worker, and the exact current base. Then run `npm run build`. The assertion uses the old public behavior and does not inspect private stores or websocket internals.

## Result

- **Reservation commit:** `20a0927b1f658076af47bc9e674c313982a22ddf`.
- **Browser:** `PASS`, exact base `4f051f9d4896141396f6a79c1eaeb5bdae16f296`, real Chromium, `--repeat-each=3`, `3/3` passed in `27.7s` on ports `17136/26136`.
- **Visible evidence:** each run showed `OPEN`, one exact message in the public `频道动态` region, `PONG`, and zero `.composer-status.state-uncertain` nodes. The fixture log showed the receipt drop path; no private state or websocket assertion was used.
- **Build:** `PASS` — `npm run build` (`vite build`, 4306 modules transformed).
- **Migration note:** the first dry execution exposed only a test-helper omission: the initial draft did not perform the legacy public recipient chooser step, so no submit occurred. The helper now follows the old `fae8b70` `send()` admission flow; the product assertion remained unchanged. The corrected repeat3 is the recorded result.
- **Scope:** only this dedicated spec and audit report changed; no product, vendor, package, or existing fixture files changed.
