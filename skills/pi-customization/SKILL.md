---
name: pi-customization
description: "Trigger: pi customization, customize pi, configurar pi, personalizar pi, mejorar pi, Pi APIs, Pi settings, Pi extensions. Configure and improve Pi using only official Pi documentation and APIs."
license: Apache-2.0
metadata:
  author: gentleman-programming
  version: "1.0"
---

## Activation Contract

Use this skill when configuring, customizing, extending, auditing, or improving Pi itself: settings, packages, skills, prompt templates, themes, keybindings, providers/models, extensions, SDK integrations, custom tools, commands, TUI components, or subagent runtime configuration.

Do not use it for ordinary project coding, Flutter work, generic agent delegation, or undocumented behavior speculation.

## Hard Rules

- Treat official Pi docs as the only source of truth. Read the relevant docs before answering or editing.
- Resolve official docs under `/home/piioni/.local/lib/node_modules/@earendil-works/pi-coding-agent/`.
- Prefer configuration over custom code when settings, packages, skills, prompts, themes, or keybindings solve the need.
- Use extensions only when Pi must register tools, commands, shortcuts, providers, lifecycle hooks, custom renderers, or TUI interactions.
- When creating a persistent extension, use the maintainable package layout: `extensions/{name}/package.json`, `tsconfig.json`, `index.ts`, and `src/index.ts`; add focused `src/` modules when the extension has config, state, tools, commands, or reusable helpers.
- Use a single `*.ts` extension file only for disposable examples or quick local experiments, not for durable user configuration.
- Never invent Pi APIs, settings keys, event names, or extension methods. Verify exact names in docs first.
- Respect scope: global config lives in `~/.pi/agent/`; project config lives in `.pi/` and requires project trust.
- After changing Pi resources, tell the user whether `/reload` is enough or a Pi restart is required.
- Warn that extensions and skills can execute powerful instructions/code; only use trusted sources.

## Decision Gates

| Need | Official surface |
| --- | --- |
| Change defaults, models, resources, UI toggles | `docs/settings.md` |
| Add reusable agent behavior | `docs/skills.md` |
| Add slash prompt workflows | `docs/prompt-templates.md` |
| Change appearance | `docs/themes.md` |
| Change keyboard behavior | `docs/keybindings.md` |
| Install/share resources | `docs/packages.md` |
| Add model/provider support | `docs/models.md`, `docs/providers.md`, `docs/custom-provider.md` |
| Add tools, commands, hooks, shortcuts, custom UI | `docs/extensions.md`, `docs/tui.md` |
| Persistent extension requested | Create package-style extension under `extensions/{name}/` with `package.json`, `tsconfig.json`, `index.ts`, `src/index.ts`; modularize `src/` when concerns split naturally |
| Throwaway extension experiment | A single `*.ts` file is acceptable, but say it is not the maintainable convention |
| Embed/control Pi from code | `docs/sdk.md`, `docs/rpc.md` |
| Configure subagents package | load `subagents-configuration` skill too |

## Execution Steps

1. Identify the target surface: settings, skill, prompt, theme, keybinding, package, model/provider, extension, SDK/RPC, or subagents.
2. Read `docs/index.md` plus every relevant doc from the Decision Gates table. Follow local cross-references when they define the API being used.
3. Inspect existing global/project files before editing: `~/.pi/agent/settings.json`, `.pi/settings.json`, resource folders, and package-specific config.
4. Choose the smallest official mechanism that satisfies the request.
5. If editing JSON, preserve existing keys and validate syntax.
6. If writing an extension, use documented imports from `@earendil-works/pi-coding-agent`, keep startup work safe, and prefer `/reload`-discoverable locations.
7. For persistent extensions, create the package layout, keep `index.ts` as a thin export, place runtime code in `src/index.ts`, and split `src/` only when it improves readability or testability.
8. If creating or updating a skill, also follow `gentle-ai-skill-creator` or `gentle-ai-skill-improver`.
9. Verify by reading changed files and, when safe, listing/validating resources with documented Pi commands or runtime tools.

## Output Contract

Return:

- Official docs read and APIs/settings verified.
- Files created or modified, with scope: global or project.
- Why the chosen Pi surface was the smallest safe option.
- Validation performed or why it was skipped.
- Required `/reload` or restart instruction.
- Remaining risks or undocumented gaps.

## References

- `/home/piioni/.local/lib/node_modules/@earendil-works/pi-coding-agent/docs/index.md`
- `/home/piioni/.local/lib/node_modules/@earendil-works/pi-coding-agent/docs/settings.md`
- `/home/piioni/.local/lib/node_modules/@earendil-works/pi-coding-agent/docs/skills.md`
- `/home/piioni/.local/lib/node_modules/@earendil-works/pi-coding-agent/docs/extensions.md`
- `/home/piioni/.local/lib/node_modules/@earendil-works/pi-coding-agent/docs/sdk.md`
