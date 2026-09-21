# TC-1499 Workspace bootstrap public-owner evidence

Reviewed base: `5a9a7df`
Scope: Workspace identity/bootstrap cache only. No product, backend, protocol,
vendor, package, or lockfile change.

## User contract

After a cold document or reload, an authenticated principal can still see its
small cached identity, member-channel directory, and profile names while the
next directory/attach facts are pending. A different authenticated principal
must not inherit the first principal's member relationship or self actor. The
public logout boundary forgets the cached identity; a later document remains at
the Auth surface until a fresh session is authenticated.

## Canonical owner

The owner chain is `WorkspaceApp → useIdentitySession → useWireSessionPort /
useWireConnection → useChannelNavigation → WorkspaceLayout`. The server
identity/session and attach membership facts remain authoritative. The cache is
only a principal-keyed startup projection; no second Workspace store or test
oracle was added.

## Evidence

- `tests/tc1499-workspace-bootstrap-public-owner.test.jsx` drives the exported
  identity, session-port, connection, and navigation hooks. It proves cached
  same-principal rows are visible while OBS and attach are deliberately held;
  a simulated `alice` session sees the same public declarations only as
  `discoverable`, with no `root` self actor; logout leaves the public
  principal empty.
- `tests/browser/tc1499-workspace-bootstrap.spec.js` drives the real
  `App → WorkspaceApp` in Chromium: login, visible account/c0/c0.project
  directory, reload with the same session, logout, and a new document that
  remains on Auth.

Focused unit result: **3 files / 6 tests passed** (`TC1499` 2/2,
`workspace-bootstrap-cache` 1/1, `atoll-session` 3/3).
Chromium result: **1 passed**.
Build: **passed** (`4306 modules`; existing large-chunk advisory only).

No public-owner product red was observed; this closes the former static-only
evidence gap without changing `src/`.
