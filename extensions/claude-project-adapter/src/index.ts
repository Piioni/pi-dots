import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { registerClaudeCommandsForProject } from "./commands";
import { registerClaudePreToolUseHooks } from "./hooks";
import {
  createClaudeProjectResolver,
  isDirectory,
  isProjectTrusted,
} from "./project";
import { injectClaudeRules, readClaudeRules } from "./rules";

export default function claudeProjectAdapter(pi: ExtensionAPI) {
  const registeredCommandNames = new Set<string>();
  const resolveProject = createClaudeProjectResolver();

  // Claude PostToolUse hooks are intentionally not implemented yet. This adapter only blocks
  // unsafe calls before Pi executes them; post-tool reminders/analysis need separate result-shape mapping.

  registerClaudePreToolUseHooks(pi, resolveProject);

  pi.on("session_start", async (_event, ctx) => {
    resolveProject.clear();
    if (!isProjectTrusted(ctx)) return;

    const project = resolveProject(ctx.cwd);
    if (!project) return;

    registerClaudeCommandsForProject(pi, project, registeredCommandNames, resolveProject);
  });

  pi.on("resources_discover", async (_event, ctx) => {
    if (!isProjectTrusted(ctx)) return;

    const project = resolveProject(ctx.cwd);
    if (!project) return;

    registerClaudeCommandsForProject(pi, project, registeredCommandNames, resolveProject);

    if (!isDirectory(project.skillsDir)) return;

    return {
      skillPaths: [project.skillsDir],
    };
  });

  pi.on("before_agent_start", async (event, ctx) => {
    if (!isProjectTrusted(ctx)) return;

    const project = resolveProject(ctx.cwd);
    if (!project) return;

    const rules = readClaudeRules(project);
    if (!rules) return;

    return {
      systemPrompt: injectClaudeRules(event.systemPrompt, rules),
    };
  });
}
