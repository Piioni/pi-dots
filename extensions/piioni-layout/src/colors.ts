import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { PermissionMode } from "./types";

const RESET = "\u001b[0m";

const MODE_ANSI: Record<PermissionMode, string> = {
  Palantír: "\u001b[36m",
  "Mithril Forge": "\u001b[32m",
  Balrog: "\u001b[31m",
};

const MODE_THEME_COLOR: Record<PermissionMode, "accent" | "success" | "error"> = {
  Palantír: "accent",
  "Mithril Forge": "success",
  Balrog: "error",
};

export function colorMode(ctx: ExtensionContext, mode: PermissionMode, text: string): string {
  try {
    return ctx.ui.theme.fg(MODE_THEME_COLOR[mode], text);
  } catch {
    return `${MODE_ANSI[mode]}${text}${RESET}`;
  }
}

export function colorText(ctx: ExtensionContext, text: string): string {
  try {
    return ctx.ui.theme.fg("text", text);
  } catch {
    return `\u001b[37m${text}${RESET}`;
  }
}

export function colorCwd(ctx: ExtensionContext, text: string): string {
  try {
    return ctx.ui.theme.fg("accent", text);
  } catch {
    return `\u001b[34m${text}${RESET}`;
  }
}

export function colorGit(ctx: ExtensionContext, text: string): string {
  try {
    return ctx.ui.theme.fg("thinkingMax", text);
  } catch {
    return `\u001b[35m${text}${RESET}`;
  }
}

export function colorDim(ctx: ExtensionContext, text: string): string {
  try {
    return ctx.ui.theme.fg("dim", text);
  } catch {
    return `\u001b[2m${text}${RESET}`;
  }
}

export function colorStatus(ctx: ExtensionContext, status: "success" | "warning" | "error" | "accent" | "dim", text: string): string {
  const ansiByStatus = {
    success: "\u001b[32m",
    warning: "\u001b[33m",
    error: "\u001b[31m",
    accent: "\u001b[36m",
    dim: "\u001b[2m",
  } satisfies Record<typeof status, string>;

  try {
    return ctx.ui.theme.fg(status, text);
  } catch {
    return `${ansiByStatus[status]}${text}${RESET}`;
  }
}

export function colorThinking(ctx: ExtensionContext, thinking: string): string {
  const normalized = thinking.toLowerCase();
  const colorByThinking: Record<string, "thinkingOff" | "thinkingMinimal" | "thinkingLow" | "thinkingMedium" | "thinkingHigh" | "thinkingXhigh" | "thinkingMax"> = {
    off: "thinkingOff",
    none: "thinkingOff",
    minimal: "thinkingMinimal",
    low: "thinkingLow",
    medium: "thinkingMedium",
    high: "thinkingHigh",
    xhigh: "thinkingXhigh",
    max: "thinkingMax",
  };
  const color = colorByThinking[normalized];

  if (!color) return colorDim(ctx, thinking);

  try {
    return ctx.ui.theme.fg(color, thinking);
  } catch {
    return colorDim(ctx, thinking);
  }
}

export function colorContextUsage(
  ctx: ExtensionContext,
  percent: number | undefined,
  text: string,
): string {
  if (typeof percent !== "number") return colorDim(ctx, text);
  if (percent >= 90) return colorStatus(ctx, "error", text);
  if (percent >= 75) return colorStatus(ctx, "warning", text);
  if (percent >= 50) return colorStatus(ctx, "accent", text);
  return colorStatus(ctx, "success", text);
}

export function colorPeach(ctx: ExtensionContext, text: string): string {
  try {
    return ctx.ui.theme.fg("syntaxNumber", text);
  } catch {
    return `\u001b[38;2;250;179;135m${text}${RESET}`;
  }
}

export function colorSapphire(ctx: ExtensionContext, text: string): string {
  try {
    return ctx.ui.theme.fg("syntaxFunction", text);
  } catch {
    return `\u001b[38;2;116;199;236m${text}${RESET}`;
  }
}
