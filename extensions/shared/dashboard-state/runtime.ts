import type { DashboardRuntimeSnapshot, DashboardUsageSnapshot } from "./types";

interface AssistantUsageContext {
  sessionManager: {
    getBranch(): Array<{
      type: string;
      message?: {
        role?: string;
        usage?: {
          input?: number;
          output?: number;
          cacheRead?: number;
          cost?: { total?: number };
        };
      };
    }>;
  };
  model?: { id: string };
  getContextUsage?: () => {
    percent?: number | null;
    tokens?: number | null;
    contextWindow?: number | null;
  } | undefined;
}

interface ThinkingLevelProvider {
  getThinkingLevel?: () => string;
}

function getUsage(ctx: AssistantUsageContext): DashboardUsageSnapshot {
  const usage = { input: 0, output: 0, cacheRead: 0, cost: 0 };
  let found = false;

  for (const entry of ctx.sessionManager.getBranch()) {
    if (entry.type !== "message") continue;
    const message = entry.message as {
      role?: string;
      usage?: {
        input?: number;
        output?: number;
        cacheRead?: number;
        cost?: { total?: number };
      };
    };
    if (message.role !== "assistant" || !message.usage) continue;

    if (typeof message.usage.input === "number") {
      usage.input += message.usage.input;
      found = true;
    }
    if (typeof message.usage.output === "number") {
      usage.output += message.usage.output;
      found = true;
    }
    if (typeof message.usage.cacheRead === "number") {
      usage.cacheRead += message.usage.cacheRead;
      found = true;
    }
    if (typeof message.usage.cost?.total === "number") {
      usage.cost += message.usage.cost.total;
      found = true;
    }
  }

  return found ? usage : {};
}

export function buildDashboardRuntimeSnapshot(
  ctx: AssistantUsageContext,
  pi: ThinkingLevelProvider,
): DashboardRuntimeSnapshot {
  const context = ctx.getContextUsage?.();
  return {
    modelId: ctx.model ? ctx.model.id : "n/a",
    thinkingLevel:
      typeof pi.getThinkingLevel === "function" ? pi.getThinkingLevel() : "n/a",
    usage: getUsage(ctx),
    context: {
      percent: typeof context?.percent === "number" ? context.percent : undefined,
      tokens: typeof context?.tokens === "number" ? context.tokens : undefined,
      contextWindow:
        typeof context?.contextWindow === "number"
          ? context.contextWindow
          : undefined,
    },
  };
}
