# Browser T-Z reservation — TC0380

- Baseline: `fae8b70:tests/browser/reading-viewport.spec.js` C2/C4 case, “keeps a live DOM selection while the visible content is stable”.
- Reserved from exact current main: `546a3d53dd59d16d04dc28a19bada7117dc46650`.
- Public successor scope: real Chromium selection across visible message content remains selected while a live tail append updates the same channel; browsing remains user-owned and the selected text is unchanged.
- Full refs/worktree search found no existing TC0380 claim/spec. Existing TC0361/TC0375 and unrelated Space/SZ work are excluded.
- No product, fixture, mock, package, snapshot, or assertion-threshold changes are in scope.
