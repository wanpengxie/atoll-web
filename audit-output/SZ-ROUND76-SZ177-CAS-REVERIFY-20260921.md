# SZ-177 CAS re-verification — A1 → B → A2

Date: 2026-09-21  
Base: `f370a874e0d9740eda4a7850877212c1f8ea94d2`  
Prior candidate: `7c56421ee8a61d6ad5d25c99122a36b9275c0ca9`  
Owner: `useConversationProjection` public viewport plus the canonical
`createViewSessionStore` activation/save/deactivate owner.  
Test: `tests/sz177-channel-replacement-bottom-cas.test.jsx`

## Contract

The user can replace channel source A with B and then return to A without a
late A1 Reading owner taking control of the current A2 view. The exact
channel/scope/view key is used throughout (`channel-a:all`, `channel-b:all`),
and the active activation plus expected revision form one public CAS boundary.

After A2 is active, an A1 `save` with its old activation/revision and an A1
`deactivate` must both return `false`. The durable public view state must keep
the A2 revision and A2 bookmark. The old public viewport must also reject its
late bottom capture/request after suspension.

## Evidence

The test uses a real `createViewSessionStore` backed by an isolated
`MemoryStorage`, not a private map or a method-only spy. A1 and A2 bookmarks
are persisted through the public viewport (`beginNavigation` plus typed
`onReadingSample`), so the store sees real revision increments. The test then
performs the explicit sequence:

```text
A1(channel-a:all) → B(channel-b:all) → A2(channel-a:all)
```

It observes A2's activation and restored A1 revision, persists the new A2
bookmark, and finally invokes the public store CAS methods with A1's stale
activation. Both late operations are rejected; `readView(channel-a,
channel-a:all)` remains at the A2 revision/bookmark. No controller refs,
private store fields, or scheduler internals are asserted.

## Verification

- SZ-177 focused Vitest: PASS, repeated 5/5.
- Adjacent `view-session`, `sz-round46-authority-replacement`, and SZ-177 tests: PASS (3 files, 11 tests).
- `npm run build`: PASS (Vite; existing chunk-size warning only).
- Product source unchanged; only the public test and this audit were added.
