import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { registerClaudeCommandsForProject } from "./commands";
import { registerClaudePreToolUseHooks } from "./hooks";
import { findClaudeProject, isDirectory } from "./project";
import { readClaudeRules } from "./rules";

export default function claudeProjectAdapter(pi: ExtensionAPI) {
  const registeredCommandNames = new Set<string>();

  // Claude PostToolUse hooks are intentionally not implemented yet. This adapter only blocks
  // unsafe calls before Pi executes them; post-tool reminders/analysis need separate result-shape mapping.

  registerClaudePreToolUseHooks(pi);

  pi.on("session_start", async (_event, ctx) => {
    const project = findClaudeProject(ctx.cwd);
    if (!project) return;

    registerClaudeCommandsForProject(pi, project, registeredCommandNames);
  });

  pi.on("resources_discover", async (_event, ctx) => {
    const project = findClaudeProject(ctx.cwd);
    if (!project) return;

    registerClaudeCommandsForProject(pi, project, registeredCommandNames);

    if (!isDirectory(project.skillsDir)) return;

    return {
      skillPaths: [project.skillsDir],
    };
  });

  pi.on("before_agent_start", async (event, ctx) => {
    const project = findClaudeProject(ctx.cwd);
    if (!project) return;

    const rules = readClaudeRules(project);
    if (!rules) return;

    return {
      systemPrompt: `${event.systemPrompt}\n\n${rules}`,
    };
  });
}
