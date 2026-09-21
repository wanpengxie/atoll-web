# TC-0327 / D-BR-06 public migration

- Baseline: `fae8b70:tests/browser/phase-d.spec.js` (`D-BR-06 human 候选来自 OBS，添加后 roster 与 membership 收敛`).
- Current public owner: `WorkspaceApp` composes `ChannelAdministrationPanel`/`GovernanceFeature` from the session directory principal projection and the canonical `useChannelRoster` projection. The feature submits `system.member.admit`; it does not invent a local membership row.
- Backend/mock authority used by the public test: the existing `actor-governance` scenario exposes `Alice` through `/obs/space/principals`; `system.member.admit` accepts `{ principal: 'alice' }`, updates the mock membership/roster facts, and emits the canonical member-created narration. No mock or protocol changes were made.
- User contract covered: channel details → Members, only OBS human candidate `Alice` is offered (current `Root` is excluded), the selected participant is observable, the exact admit command targets `c0` and `alice`, and the UI waits for the refreshed authoritative roster before showing `成员已就绪`.
- Scope: browser migration and audit only; no product, store, compatibility, backend, or protocol changes.
