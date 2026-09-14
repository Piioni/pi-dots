# Delta Specification: Code Block Copying

## ADDED Requirements

### Requirement: Fullscreen per-block control
In fullscreen TUI mode, expose one interactive Copy control for every complete fenced code block in a rendered assistant message. Activating a control MUST copy only its associated block.

#### Scenario: Select one of multiple blocks
- GIVEN an assistant message contains two complete fenced blocks
- WHEN the user activates Copy for block two
- THEN only block two is sent to the clipboard

#### Scenario: Incomplete streamed fence
- GIVEN a streamed block has no closing fence
- WHEN it is rendered
- THEN it has no actionable Copy control and remains visible

### Requirement: Regular fallback
In regular TUI mode, provide `/copy-code [number]` as a keyboard-driven fallback. Multiple eligible blocks MUST be listed in deterministic source order.

#### Scenario: Select by number
- GIVEN three complete blocks
- WHEN the user runs `/copy-code 2`
- THEN only block two is copied without mouse capture

#### Scenario: No eligible block
- GIVEN the latest assistant message has no complete fenced block
- WHEN `/copy-code` runs
- THEN no clipboard write occurs and the user receives an understandable notice

### Requirement: Raw payload fidelity
Copy operations MUST preserve the exact raw code and line boundaries while excluding opening/closing fences, language info, ANSI styling, borders, labels, padding, and Copy-control text. Code that resembles decoration MUST remain unchanged.

### Requirement: Feedback
Successful writes MUST produce transient copied feedback after the clipboard promise resolves. Rejected writes MUST produce failure feedback and MUST NOT claim success. Duplicate in-flight writes for one block MUST be suppressed.

### Requirement: Streaming and identity
Only currently complete fences are eligible. As streaming closes a fence, exactly one corresponding target becomes available in source order. Stale, partial, adjacent, or mismatched content MUST never be copied.

### Requirement: Responsive and safe interaction
Rendered lines MUST stay within the available width. Fullscreen pointer handling MUST be local to component coordinates and leave scrolling, selection, wheel, right-click, and unrelated events untouched. Regular mode MUST retain terminal mouse ownership.

### Requirement: Compatibility fallback
If the private assistant transcript child shape cannot be validated, inline controls MUST be disabled without changing normal rendering; `/copy-code` MUST remain available.

### Requirement: Regression preservation
The existing fullscreen rendering fix, code-block visuals, syntax highlighting, and lifecycle restoration MUST remain intact. No installed dependency or Pi core file may be modified.

## Verification matrix
- Parser: fences, nesting, multiple/empty blocks, info strings, partial closures, payload fidelity.
- Regular fallback: direct selection, selector, invalid/no target, cancellation, branch/snapshot precedence, clipboard outcomes.
- Fullscreen: per-block click, local hit testing, scroll, resize, narrow widths, streaming, invalidation, compatibility mismatch.
