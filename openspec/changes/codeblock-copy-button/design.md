# Design: Per-codeblock Copy in ui-overhaul

## Architecture
- `src/code-blocks.ts`: pure source parser using the public `Marked` lexer; returns complete block metadata and fail-closed candidates.
- `src/code-copy.ts`: clipboard gateway, `/copy-code [number]`, deterministic selector, source registry, generation and feedback handling.
- `src/assistant-code-controls.ts`: the only module allowed to inspect Pi's private assistant child shape; validates atomically and decorates compatible Markdown children with `MouseRegion`.
- `src/markdown.ts`: preserves current rendering and exposes width-safe Copy affordance/hit targets.
- `src/state.ts`, `src/types.ts`, `src/lifecycle.ts`, `src/index.ts`: isolated state, contracts, lifecycle and registration.

## Interaction
- Fullscreen controls use public `MouseRegion`, local component coordinates, and `tui.requestRender()`.
- Regular fallback uses `/copy-code [number]` and `SelectList`; no global shortcut is added.
- Clipboard uses public `copyToClipboard()` and notifies only after settlement.

## Safety
- Never derive payloads from ANSI-rendered lines.
- Never use global terminal coordinates; recompute local targets on every render/resize.
- If Pi's private child tree changes, preserve original children and disable only inline controls.
- Keep the existing UserMessage stale-render fix and do not add a width-only cache.

## Compatibility risk
Pi lacks a public transcript renderer factory. The private-shape adapter is intentionally isolated and tested against the installed host. A future Pi upgrade may disable inline controls until the adapter is updated; the regular command remains the fallback. Installed `node_modules`, Pi core, settings, themes, and package metadata remain untouched.
