# Vendored react-virtuoso 4.18.13

This directory contains the trace-free Atoll build of
`react-virtuoso@4.18.13`. It is derived from upstream git commit
`ebd6b0f0ff41e1fe003a50fe47b168b3ed698868` under the included MIT license.

The package version remains `4.18.13`; identify this build by hashes:

- tarball SHA-256:
  `d968daf2793aeed2b5d9246ca9c81735bd47d9f9fe6e702b47415895754f7d26`
- installed `dist/index.mjs` SHA-256:
  `440c6f4d1bcbfc00caf54ab0fe6a604e41c9a30c45abb0e2123a6c7f66a51aa0`
- npm integrity:
  `sha512-VvEamerLkWjr2xuwub+eYgNRnq7FPZHiUpG1cYAiawOQGKgPLxEwEiInkc/t+0/q3B6h5hfQh1UxhbmO3sBOpg==`

## Rebuild

Apply the files under `patches/` to a clean checkout of the upstream commit in
this exact order:

1. `base-0c5-formal-gate.patch`
2. `observer-generation-delta.patch`
3. `formal-flow-invariant-delta.patch`
4. `stable-observer-delta.patch`
5. `formal-prop-stability-delta.patch`
6. `formal-tail-flow-delta.patch`

| patch | SHA-256 |
| --- | --- |
| `base-0c5-formal-gate.patch` | `eea020d008098b85d1dac48fd3643eeca176dbf0f5a350e6ffeafe1ec5de276c` |
| `observer-generation-delta.patch` | `4dcc3142a9c0edfb0f0d273df369b9bb5cb1e24814f412e86f5f4f38c3bf74e3` |
| `formal-flow-invariant-delta.patch` | `5327b3f66a246d422cccf1bf596f4ce0146f443a5c8b371d763955128af6f252` |
| `stable-observer-delta.patch` | `522d35f3b11835b38cb63c52c2994e2cf2f7123a3240fe429af7d25b1d020693` |
| `formal-prop-stability-delta.patch` | `d9a3dee03a9b00dbca7daed8ed2e027c34952eeef549161220e2f30cd7d0be32` |
| `formal-tail-flow-delta.patch` | `4f83cb255924b64c8a5ac3d5b49491b6c65a1ff3251a7888e67d1eff151ff91e` |

Then use the upstream pinned toolchain:

```sh
corepack pnpm install --frozen-lockfile
corepack pnpm --filter react-virtuoso test
corepack pnpm --filter react-virtuoso typecheck
corepack pnpm --filter react-virtuoso lint
corepack pnpm --filter react-virtuoso format:check
corepack pnpm --filter react-virtuoso build
```

Expected output hashes:

| file | SHA-256 |
| --- | --- |
| `dist/index.mjs` | `440c6f4d1bcbfc00caf54ab0fe6a604e41c9a30c45abb0e2123a6c7f66a51aa0` |
| `dist/index.cjs` | `e9457d73c15034c700505ab0e1a1348474add0862c35da609fc7aeb52de0c12a` |
| `dist/index.d.ts` | `a116bbb766f6c83b9449de5dda6c31d5a11487c57e09181dba72799b4c7f9c73` |

To reverse the source patch, apply the six patches with
`git apply --reverse` in reverse order. To roll back this application, restore
the dependency and lockfile to registry `react-virtuoso@4.18.13`, perform a
clean lock-based install, and rerun the same tests. Do not edit `node_modules`
in place as a deployment mechanism.

The application uses npm scripts and `package-lock.json` as its operational
install path. Its tracked `pnpm-lock.yaml` is also synchronized to this exact
tarball so either package manager cannot silently select the registry build.

The application adapter is frozen separately at
`app/formal-feedback-948e-to-102609.patch` (SHA-256
`0ad826fa6c9c01b77c5066ae478aea450aa8ecbbd4bd8b6c07245bc500f45e5c`).
It applies only when `LegendMessageList.jsx` has the safe-disconnected base
hash `948e3127a91bb5cb6ec1f957b7ceab27e01c8ffb88e60ef8ed2aee8cd4e4663d`
and produces the independently checked wiring hash
`10260969385a4877c30d31bee97aec2ffc8bc77394094f662564e1681bbe0f5c`.
