# Browser T-Z reservation — TC0375

- Baseline: `fae8b70:tests/browser/reading-viewport.spec.js` P1 case, “tail downward wheel with no movement keeps following and the next append reachable”.
- Reserved from exact current main: `1eecd0dba854c7ef4e097abfecdec23050b1af41`.
- Public successor scope: real Chromium at the installed tail; a real downward wheel that cannot move must preserve following, then one canonical live append must remain reachable at the tail.
- Exclusions checked before reservation: TC0361, TC0342, TC0357, Space governance, and all SZ claims; no existing TC0375 ref/worktree/spec was found.
- No product, fixture, mock, package, snapshot, or assertion-threshold changes are in scope.
