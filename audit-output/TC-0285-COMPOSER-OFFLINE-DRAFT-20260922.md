# TC-0285 — Composer offline known-member draft successor

Date: 2026-09-22

Baseline: `fae8b70:tests/browser/offline-composer-recovery.spec.js:49`

Current base: `73413e2b6e6734e8463b5a0b38a386d0b0e789f0`

Branch: `codex/composer-tc0285-offline-73413e2`

Worktree: `/home/xiewanpeng/.atoll/device/daemons/local-device/channels/c0.dev/.tmp-tc0285-offline-73413e2`

## User contract and owner

The user first chooses a known `steward` recipient while connected, then loses
the connection, edits a Composer draft, and sees that offline editing remains
available. After reconnecting and reloading, the same body and recipient are
restored and one visible message is sent. The public owner is Composer's
`useComposerSubmissionRuntime` draft/outbox boundary; no roster, Workspace, or
second draft owner is involved.

This is distinct from TC-1199/SZ-031: TC-1199 rejects an unknown-access send
before any durable row exists, while TC-0285 starts with a known recipient and
exercises offline draft continuity.

## Successor change

The retained public browser test already performed the action sequence, but its
current assertion stopped at the connection badge and did not prove the
user-visible offline editing state. The successor adds the public
`离线编辑；发送会先保存到本机` assertion immediately after the drop, while
retaining the full recipient selection, draft edit, reconnect/reload, clear-on-
send, and exactly-one visible row assertions. No private IndexedDB oracle,
product code, mock protocol, or compatibility layer was added.

The older fae test also inspected an IndexedDB submission row during a second
offline send. That is an implementation detail rather than a public UI
observable and is intentionally not reintroduced here; this report claims the
public draft/recipient continuity and exactly-once visible outcome only.

## Evidence

Focused public Chromium, repeated three times:

```text
ATOLL_TEST_WEB_PORT=15490 ATOLL_TEST_MOCK_PORT=19490 \
npx playwright test tests/browser/offline-composer-recovery.spec.js \
  --workers=1 --repeat-each=3 --reporter=line \
  --output=test-results-tc0285-public-repeat3-final
→ 3 passed (22.9s)
```

Focused adjacent owner tests:

```text
npx vitest run tests/offline-recovery.test.jsx \
  tests/submission-outbox-current.test.jsx \
  tests/submission-outbox.test.jsx --reporter=dot
→ 3 files, 35 tests passed
```

Build:

```text
npm run build
→ exit 0; 4306 modules transformed (existing chunk-size advisory only)
```

No Composer product implementation changed; the only source diff is the one
public browser assertion in `tests/browser/offline-composer-recovery.spec.js`.
