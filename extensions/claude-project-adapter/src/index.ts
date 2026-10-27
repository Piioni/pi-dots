import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { registerClaudeAgentTools } from "./agents.ts";
import { registerClaudeCommandsForProject } from "./commands.ts";
import { registerClaudeLifecycleHooks, registerClaudePreToolUseHooks } from "./hooks.ts";
import {
  createClaudeProjectResolver,
  isDirectory,
  isProjectTrusted,
} from "./project.ts";
import { injectClaudeRules, readClaudeRules } from "./rules.ts";
import { discoverClaudeSkills } from "./skills.ts";
import { loadClaudeSettings } from "./settings.ts";

export default function claudeProjectAdapter(pi: ExtensionAPI) {
  const registeredCommandNames = new Set<string>();
  const reportedCommandDiagnostics = new Set<string>();
  const resolveProject = createClaudeProjectResolver();
  let lastDiagnosticDelivery: { root: string; signature: string } | undefined;
  const reportSettingsDiagnostics = (
    ctx: ExtensionContext,
    project: ReturnType<typeof resolveProject>,
  ) => {
    if (!project) {
      lastDiagnosticDelivery = undefined;
      return;
    }
    const diagnostics = loadClaudeSettings(project.claudeDir).diagnostics;
    const signature = JSON.stringify(diagnostics);
    if (lastDiagnosticDelivery?.root === project.root && lastDiagnosticDelivery.signature === signature) return;
    lastDiagnosticDelivery = { root: project.root, signature };
    for (const message of diagnostics) ctx.ui.notify(message, "warning");
  };
  const registerCommands = (ctx: ExtensionContext, project: NonNullable<ReturnType<typeof resolveProject>>) => {
    registerClaudeCommandsForProject(pi, project, registeredCommandNames, resolveProject, (message) => {
      const key = `${project.root}\0${message}`;
      if (reportedCommandDiagnostics.has(key)) return;
      reportedCommandDiagnostics.add(key);
      ctx.ui.notify(message, "warning");
    });
  };

  // Claude PostToolUse hooks are intentionally not implemented yet. This adapter only blocks
  // unsafe calls before Pi executes them; post-tool reminders/analysis need separate result-shape mapping.

  registerClaudePreToolUseHooks(pi, resolveProject);
  registerClaudeLifecycleHooks(pi, resolveProject);
  registerClaudeAgentTools(pi, resolveProject);

  pi.on("session_start", async (_event, ctx) => {
    if (!isProjectTrusted(ctx)) {
      lastDiagnosticDelivery = undefined;
      return;
    }

    const project = resolveProject(ctx.cwd);
    if (!project) {
      lastDiagnosticDelivery = undefined;
      return;
    }
    reportSettingsDiagnostics(ctx, project);

    registerCommands(ctx, project);
  });

  pi.on("resources_discover", async (_event, ctx) => {
    if (!isProjectTrusted(ctx)) {
      lastDiagnosticDelivery = undefined;
      return;
    }

    const project = resolveProject(ctx.cwd);
    if (!project) {
      lastDiagnosticDelivery = undefined;
      return;
    }
    reportSettingsDiagnostics(ctx, project);

    registerCommands(ctx, project);

    if (!isDirectory(project.skillsDir)) return;

    const skills = discoverClaudeSkills(project);
    for (const message of skills.diagnostics) ctx.ui.notify(message, "warning");
    return skills.paths.length > 0 ? { skillPaths: skills.paths } : undefined;
  });

  pi.on("before_agent_start", async (event, ctx) => {
    if (!isProjectTrusted(ctx)) {
      lastDiagnosticDelivery = undefined;
      return;
    }

    const project = resolveProject(ctx.cwd);
    if (!project) {
      lastDiagnosticDelivery = undefined;
      return;
    }
    reportSettingsDiagnostics(ctx, project);

    const rules = readClaudeRules(project);
    for (const message of rules.diagnostics) ctx.ui.notify(message, "warning");
    if (!rules.content) return;

    return {
      systemPrompt: injectClaudeRules(event.systemPrompt, rules.content),
    };
  });
}
