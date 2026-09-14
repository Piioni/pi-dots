# Tasks: Code Block Copy Button

## Delivery
- Strategy: `stacked-to-main`
- Two work units; maintainer explicitly accepted `size:exception` rather than splitting further.
- Unit 1 is source extraction plus regular fallback.
- Unit 2 is fullscreen controls and compatibility adapter.

## Work Unit 1 — source extraction and regular fallback

- [x] Add fenced-source extraction and tests for complete/incomplete fences, nesting, order, and payload fidelity. <!-- sdd-owner: implementation -->
- [x] Add the `copy-code [number]` command, selector, clipboard gateway, feedback, generation and source lifecycle wiring with focused tests. <!-- sdd-owner: implementation -->
- [x] Verify Unit 1 with `npm test`, `npm run typecheck`, and `git diff --check`. <!-- sdd-owner: implementation -->

## Work Unit 2 — fullscreen controls

- [x] Add compatibility adapter and tests for original transcript construction, atomic validation, and fail-closed fallback. <!-- sdd-owner: implementation -->
- [x] Add width-safe per-block Copy affordances and local hit targets while preserving existing rendering. <!-- sdd-owner: implementation -->
- [x] Integrate fullscreen mouse handling, streaming/invalidation/resize/lifecycle behavior and tests. <!-- sdd-owner: implementation -->
- [ ] Verify Unit 2 with tests, typecheck, diff checks, and regular/fullscreen reload smoke tests. <!-- sdd-owner: implementation -->

## Parent actions

- [ ] Review Unit 1 and Unit 2 boundaries and verify no forbidden paths changed. <!-- sdd-owner: parent -->
- [ ] Run delivery validation after approved review. <!-- sdd-owner: parent -->

## Review Workload Forecast

Estimated total: 1,100–1,600 changed lines. The maintainer accepted `size:exception`; work remains split into two reviewable stacked-to-main units.
