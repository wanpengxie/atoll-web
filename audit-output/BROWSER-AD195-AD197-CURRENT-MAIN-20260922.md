# AD-195 / AD-197 exact-main acceptance

- Exact product/test base: `be18ef084676c91c58780b5d65a45190efb618b1` (`be18ef0`), detached worktree.
- Focused blocked-round26 contract: `npx vitest run tests/blocked-round26-public-owner.test.jsx --reporter=dot -t 'AD-195|AD-197'` → **2 passed, 18 skipped**.
- Browser successor: `tests/browser/ad195-ad197-workspace-four-state.spec.js`.
- Browser command: `npx playwright test tests/browser/ad195-ad197-workspace-four-state.spec.js --repeat-each=3 --reporter=line` → **21/21 passed**.
- Browser matrix: desktop and mobile public AppShell/Workspace paths each cover ready, running/delayed convergence, and server-rejected error; mobile additionally covers the bounded public unavailable-owner surface through `空间管理`. The compact terminal unavailable wording remains covered by the focused AD-195/197 unit contract because the existing mock has no public compact-terminal fixture and no private terminal/diagnostic state was injected.
- Build: `npm run build` → **passed**.
- Scope: test and audit only. No product, vendor, package, mock scenario, fixture, selector workaround, skip, or assertion relaxation was changed.

## Public evidence

1. Ready: real `新建频道` route reaches `频道已经可以打开和协作。`, all four convergence steps show `已确认`, and the child is exposed in the desktop rail or after opening the mobile channel list.
2. Running: `channel-governance-delay` keeps the public submit control in its bounded submitting/waiting state before the same route reaches ready.
3. Error: `channel-governance-denied` renders a public alert and never exposes `进入新频道` or the ready message.
4. Unavailable: the real mobile Workspace `空间管理` route publishes the explicit `当前 wire/session 没有空间治理结果投影` status rather than inventing a successful result. The canonical AD-195/197 compact-result copy is independently green in the two focused unit cases above.
