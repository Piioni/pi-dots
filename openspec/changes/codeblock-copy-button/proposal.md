# Proposal: Code Block Copy Button

## Goal
Make rendered assistant Markdown code blocks easy to copy without borders, labels, ANSI styling, or Markdown fences.

## Confirmed decisions
- Fullscreen mode exposes an interactive Copy control for each complete fenced block.
- Regular mode provides `/copy-code [number]` as a keyboard-driven fallback because regular TUI preserves terminal scrollback mouse ownership.
- Clipboard payload is raw code only.
- The implementation lives entirely in the local `extensions/ui-overhaul` extension. Installed `node_modules` and Pi core are out of scope.
- The feature is split into two stacked-to-main work units; the maintainer explicitly accepted the size exception for keeping these two units.

## Scope
- Source extraction and regular fallback.
- Fullscreen controls with fail-closed compatibility behavior.
- Success/failure feedback, streaming-safe eligibility, responsive layout, and regression coverage.

## Non-goals
- Changing syntax highlighting.
- Capturing mouse input in regular mode.
- Copying whole assistant messages automatically.
