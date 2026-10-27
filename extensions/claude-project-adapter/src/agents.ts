import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { Type, type Static } from "typebox";
import type { ExtensionAPI, ExtensionContext, ToolDefinition } from "@earendil-works/pi-coding-agent";
import { parseFrontmatter } from "./frontmatter.ts";
import { isDirectory, isFile, isProjectTrusted, type ClaudeProject, type ClaudeProjectResolver } from "./project.ts";

const toolNames: Record<string, string> = {
  Read: "read",
  Grep: "grep",
  Glob: "find",
  Bash: "bash",
  PowerShell: "powershell",
  ToolSearch: "tool_search",
};
const AGENT_LIMIT = 1_000_000;

type ClaudeAgent = {
  name: string;
  description: string;
  instructions: string;
  declaredModel: string;
  declaredTools: string[];
  tools: string[];
  unsupportedTools: string[];
  restrictionError?: string;
};

function discoverAgents(project: ClaudeProject): { agents: ClaudeAgent[]; diagnostics: string[] } {
  const directory = join(project.claudeDir, "agents");
  const agents: ClaudeAgent[] = [];
  const diagnostics: string[] = [];
  if (!isDirectory(directory)) return { agents, diagnostics };
  const visit = (current: string) => {
    for (const entry of readdirSync(current, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const path = join(current, entry.name);
      if (entry.isDirectory()) visit(path);
      else if (entry.isFile() && entry.name.endsWith(".md") && isFile(path)) {
        let content: string;
        try {
          content = readFileSync(path, "utf8");
        } catch {
          diagnostics.push(`Could not read Claude agent ${path}.`);
          continue;
        }
        if (content.length > AGENT_LIMIT) {
          diagnostics.push(`Claude agent ${path} exceeds the 1 MB size limit.`);
          continue;
        }
        const parsed = parseFrontmatter(content);
        const name = parsed.metadata.get("name")?.trim();
        const description = parsed.metadata.get("description")?.trim();
        if (parsed.error || !name || !description || !parsed.body.trim()) {
          diagnostics.push(`Claude agent ${path} has invalid frontmatter or missing name, description, or instructions.`);
          continue;
        }
        const declaredModel = parsed.metadata.get("model")?.trim() || "default";
        const rawTools = parsed.metadata.get("tools");
        let restrictionError: string | undefined;
        if (rawTools === undefined) restrictionError = "missing tools restriction";
        else if (rawTools.trim() !== "[]" && (rawTools.trim() === "" || !rawTools.split(",").every((tool) => tool.trim()))) restrictionError = "invalid tools restriction";
        const declaredTools = rawTools === undefined || rawTools.trim() === "" || rawTools.trim() === "[]"
          ? []
          : rawTools.split(",").map((tool) => tool.trim());
        if (restrictionError) diagnostics.push(`Claude agent '${name}' in ${path} has ${restrictionError}; no tools will be granted.`);
        const unsupportedTools = declaredTools.filter((tool) => !toolNames[tool]);
        agents.push({
          name,
          description,
          instructions: parsed.body.trim(),
          declaredModel,
          declaredTools,
          tools: declaredTools.filter((tool) => toolNames[tool]).map((tool) => toolNames[tool]),
          unsupportedTools,
          restrictionError,
        });
      }
    }
  };
  try {
    visit(directory);
  } catch {
    diagnostics.push(`Could not enumerate Claude agents in ${directory}.`);
  }
  return { agents, diagnostics };
}

function currentAgents(ctx: ExtensionContext, resolveProject: ClaudeProjectResolver) {
  if (!isProjectTrusted(ctx)) return { agents: [], diagnostics: ["Claude agents are unavailable because this project is not trusted."] };
  const project = resolveProject(ctx.cwd);
  return project ? discoverAgents(project) : { agents: [], diagnostics: [] };
}

function activeModel(ctx: ExtensionContext): string | undefined {
  return ctx.model ? `${ctx.model.provider}/${ctx.model.id}` : undefined;
}

const listParams = Type.Object({});
const runParams = Type.Object({ name: Type.String(), task: Type.String() });
type RunParams = Static<typeof runParams>;

export function registerClaudeAgentTools(pi: ExtensionAPI, resolveProject: ClaudeProjectResolver): void {
  const listTool: ToolDefinition<typeof listParams> = {
    name: "claude_agent_list",
    label: "Claude agents",
    description: "List this trusted project's .claude/agents definitions. SDK execution is pending T4b; listed agents are not yet runnable.",
    parameters: listParams,
    async execute(_id, _params, _signal, _update, ctx) {
      const { agents, diagnostics } = currentAgents(ctx, resolveProject);
      return {
        content: [{ type: "text", text: JSON.stringify({ agents: agents.map(({ name, description, instructions, declaredModel, declaredTools, tools, unsupportedTools, restrictionError }) => ({ name, description, instructions, declaredModel, declaredTools, tools, unsupportedTools, restrictionError })), diagnostics, execution: "pending T4b SDK backend" }, null, 2) }],
        details: undefined,
      };
    },
  };
  const runTool: ToolDefinition<typeof runParams> = {
    name: "claude_agent_run",
    label: "Run Claude agent",
    description: "Preflight a trusted project agent and task. Actual SDK execution is not implemented yet (T4b pending); this tool never fabricates an agent result.",
    parameters: runParams,
    async execute(_id, params: RunParams, signal, _update, ctx) {
      if (signal?.aborted) throw new Error("Claude agent task was cancelled before preflight.");
      if (!params.name?.trim() || !params.task?.trim()) throw new Error("A valid agent name and non-empty task are required.");
      const { agents } = currentAgents(ctx, resolveProject);
      const agent = agents.find((candidate) => candidate.name === params.name);
      if (!agent) throw new Error(`Claude agent '${params.name}' was not found in the current trusted project.`);
      if (agent.restrictionError) throw new Error(`Claude agent '${agent.name}' has ${agent.restrictionError}; no tools will be granted.`);
      if (agent.unsupportedTools.length) throw new Error(`Claude agent '${agent.name}' declares unsupported tools: ${agent.unsupportedTools.join(", ")}.`);
      const model = activeModel(ctx);
      if (!model) throw new Error("An active Pi model is required before Claude agent execution.");
      throw new Error(`SDK execution is not implemented yet (T4b pending). Claude model alias '${agent.declaredModel}' would use active Pi model '${model}'.`);
    },
  };
  pi.registerTool(listTool);
  pi.registerTool(runTool);
}
