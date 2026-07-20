import { formatCost, formatTokens } from "./format";
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
          cacheWrite?: number;
          cost?: { total?: number };
        };
      };
    }>;
  };
  model?: { id: string; provider: string };
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
  const usage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0 };
  let found = false;

  for (const entry of ctx.sessionManager.getBranch()) {
    if (entry.type !== "message") continue;
    const message = entry.message as {
      role?: string;
      usage?: {
        input?: number;
        output?: number;
        cacheRead?: number;
        cacheWrite?: number;
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
    if (typeof message.usage.cacheWrite === "number") {
      usage.cacheWrite += message.usage.cacheWrite;
      found = true;
    }
    if (typeof message.usage.cost?.total === "number") {
      usage.cost += message.usage.cost.total;
      found = true;
    }
  }

  return found ? usage : {};
}

export function buildUsageSummary(runtime: Pick<DashboardRuntimeSnapshot, "usage" | "context">): string {
  const usageParts: string[] = [];
  const contextParts: string[] = [];

  if (typeof runtime.usage.input === "number") {
    usageParts.push(`in ${formatTokens(runtime.usage.input)}`);
  }
  if (typeof runtime.usage.output === "number") {
    usageParts.push(`out ${formatTokens(runtime.usage.output)}`);
  }
  if (typeof runtime.usage.cacheRead === "number") {
    usageParts.push(`read ${formatTokens(runtime.usage.cacheRead)}`);
  }
  if (typeof runtime.usage.cacheWrite === "number") {
    usageParts.push(`write ${formatTokens(runtime.usage.cacheWrite)}`);
  }
  if (typeof runtime.usage.cost === "number") {
    usageParts.push(`$${formatCost(runtime.usage.cost)}`);
  }

  if (typeof runtime.context.percent === "number") {
    contextParts.push(`${Math.round(runtime.context.percent)}%`);
  }
  if (
    typeof runtime.context.tokens === "number" ||
    typeof runtime.context.contextWindow === "number"
  ) {
    contextParts.push(
      `${formatTokens(runtime.context.tokens)}/${formatTokens(runtime.context.contextWindow)}`,
    );
  }

  return [
    usageParts.length ? `Tokens: ${usageParts.join(" ")}` : "",
    contextParts.length ? `Context: ${contextParts.join(" ")}` : "",
  ]
    .filter(Boolean)
    .join(" • ");
}

export function buildDashboardRuntimeSnapshot(
  ctx: AssistantUsageContext,
  pi: ThinkingLevelProvider,
): DashboardRuntimeSnapshot {
  const context = ctx.getContextUsage?.();
  const runtime: Omit<DashboardRuntimeSnapshot, "usageSummary"> = {
    modelId: ctx.model ? ctx.model.id : "n/a",
    providerId: ctx.model ? ctx.model.provider : "n/a",
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

  return {
    ...runtime,
    usageSummary: buildUsageSummary(runtime),
  };
}
