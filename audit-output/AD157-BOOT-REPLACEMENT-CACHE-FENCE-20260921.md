# AD157 boot-replacement cache admission

- Exact verification HEAD: `b9dbc9d356bbda84b13e9a96b4ef7487e79c80b2`.
- User capability: a completion already read from an old boot must not
  reappear as a notification or Replica row after the replacement boot grants
  only the current channel.
- Public owner: `ChannelFeedRuntime.enqueue` admission into the existing
  `ChannelReplica`; no notification-side store or protocol shim is involved.

## Reproduction and result

The existing public-owner case in
`tests/blocked-round20-public-owner.test.jsx` was run against the exact HEAD:

```text
npx vitest run tests/blocked-round20-public-owner.test.jsx \
  --reporter=verbose -t 'AD-157'
```

Before the test-only promotion it was marked `it.fails`, but Vitest reported
`Expect test to fail`: the stale cache completion was rejected, so the test
unexpectedly passed. The marker was promoted to a normal assertion; the case
now passes directly.

The scenario starts with `round20-old-boot`, replaces the grants with
`round20-new-boot` containing only `c0`, then injects a `source: 'cache'` row
for `c1`. `stateFor('c1')?.rows.has(3)` remains false. The stale completion
therefore cannot create a notification/Replica projection in the replacement
world.

No product source, backend, vendor, or protocol was changed. The only commit
delta is the existing evidence marker promotion and this audit report.
