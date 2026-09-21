# E–H EH06-05 public-owner migration

Baseline: `fae8b70:tests/f6-performance.test.jsx`, case
`Markdown 默认渲染文档并允许切换到高亮源码`.

| Contract field | Evidence |
|---|---|
| User capability | A user opening a Markdown artifact can read the rendered document, then explicitly switch to source and inspect the highlighted source. |
| Architectural invariant | The Files artifact preview has one public rendering owner; the preview/source mode is a user command, and source rendering does not manufacture a second file/navigation owner. |
| Current public owner | `src/ui/features/files/ArtifactPreviewPanel.jsx` (`ArtifactPreviewPanel` → `Preview` → `MarkdownContent` / `SourcePreview`). |
| Baseline setup/action/result | Render `ArtifactPreviewBody` with a ready `README.md` Markdown payload; see the rendered `标题`, click `源码`, then see `.artifact-source-preview` containing `const ready = true`. |
| Current result | The same setup is expressed through the public `ArtifactPreviewPanel` port. The initial DOM has the rendered heading and no source line-number surface; after the user click it has source text and Prism tokenized output. |
| Disposition | `PROVEN-DIRECT`: focused Vitest case passes (1/1, repeated in the combined focused run). This is a direct public-owner supplement to the existing browser file-reference proof; it does not replace or weaken that proof. |

Focused evidence:

- `vitest run tests/artifact-preview-resolve.test.jsx -t EH06-05`: 1/1 pass.
- The existing real-entry `tests/browser/nr19-file-reference.spec.js` `NR19-01` passed 3/3 with `--repeat-each=3`.
- The containing artifact-preview unit file has one unrelated pre-existing jsdom
  clipboard setup failure (`Object.assign(navigator, { clipboard })`); its
  `it.fails` malformed-fixture witness remains unchanged. The new case itself
  is green and does not mask that red.

The worktree changes only `tests/artifact-preview-resolve.test.jsx` and this audit.
No product, vendor, package, lockfile, compatibility API, or second owner was
changed.
