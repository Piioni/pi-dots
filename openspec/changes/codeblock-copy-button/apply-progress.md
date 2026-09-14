# Apply Progress: codeblock-copy-button

## Unit 1 complete
- Source extraction and regular `/copy-code [number]` fallback implemented.
- Fullscreen inline controls intentionally deferred to Unit 2.
- Automated verification: 28/28 `ui-overhaul` tests passed; `npm run typecheck` passed; `git diff --check` passed.
- Scope cleanup removed worker-created tool-card files and restored an unrelated theme change.
- Known pre-existing changes were preserved.

## Unit 2 implementation
- Added `assistant-code-controls.ts`, the sole private transcript-shape adapter. It calls Pi's original assistant construction first, validates the entire child shape before changing it, and fails closed without altering incompatible rendering.
- Added complete-fence-only Copy controls with width-safe header layout and render-local hit targets. Raw parser payloads remain the source for clipboard writes.
- Wired public `MouseRegion` dispatch in fullscreen mode. The existing `/copy-code` command remains the regular-mode fallback. Streaming rebuilds recompute eligible controls, Markdown renders recompute targets on resize, and lifecycle shutdown restores the assistant patch.
- Persisted completed implementation checkboxes in `tasks.md` for the first three Unit 2 rows.

### TDD Cycle Evidence
| Task | Test File | Layer | Safety Net | RED | GREEN | TRIANGULATE | REFACTOR |
|---|---|---|---|---|---|---|---|
| Compatibility adapter | `src/assistant-code-controls.test.ts` | Unit | 32/32 suite baseline | Missing adapter module | 4 focused tests passed | Complete, incompatible, local event, and streaming cases | No further change needed |
| Copy affordance layout | `src/ui-overhaul.test.ts` | Unit | Existing renderer tests green | Missing renderer export | 15 focused tests passed | Multiple blocks plus width-8 layout | Extracted header renderer |
| Lifecycle/render integration | `src/assistant-code-controls.test.ts`, `src/ui-overhaul.test.ts` | Unit | Focused tests green | Controls absent from patched Markdown/lifecycle | 19 focused tests passed | Lifecycle restore and local target dispatch covered | No further change needed |

## Verification evidence
- `npm test` in `extensions/ui-overhaul`: **38/38 passed**.
- `npm run typecheck` in `extensions/ui-overhaul`: **passed**.
- `git diff --check` from `/home/piioni/.pi/agent`: **passed**.
- Regular/fullscreen `/reload` clipboard smoke tests: **not run**; this executor has no interactive Pi TUI session to click a fullscreen control or exercise regular terminal mouse ownership.

## Files changed for Unit 2
- `extensions/ui-overhaul/src/assistant-code-controls.ts`
- `extensions/ui-overhaul/src/assistant-code-controls.test.ts`
- `extensions/ui-overhaul/src/index.ts`
- `extensions/ui-overhaul/src/lifecycle.ts`
- `extensions/ui-overhaul/src/markdown.ts`
- `extensions/ui-overhaul/src/prototype-patches.ts`
- `extensions/ui-overhaul/src/state.ts`
- `extensions/ui-overhaul/src/ui-overhaul.test.ts`

## Remaining implementation task
- [ ] Verify Unit 2 with tests, typecheck, diff checks, and regular/fullscreen reload smoke tests. <!-- sdd-owner: implementation -->

## Deferred parent lifecycle actions
- [ ] Review Unit 1 and Unit 2 boundaries and verify no forbidden paths changed. <!-- sdd-owner: parent -->
- [ ] Run delivery validation after approved review. <!-- sdd-owner: parent -->

## Workload and status
- PR boundary: stacked-to-main Unit 2 (`fullscreen-controls`); the maintainer-approved `size:exception` remains in effect.
- Consumed status: `codeblock-copy-button`, OpenSpec authoritative, apply ready, repo-local edits constrained to `/home/piioni/.pi/agent`; this apply touched only `extensions/ui-overhaul/src/**` plus the required SDD progress/checkbox artifacts.
- Action-context warnings: none. No design deviations.
