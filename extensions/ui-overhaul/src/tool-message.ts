import { isSeparatorLine, isVisiblyBlank, stripAnsi, styled, themedBackground } from "./rendering.ts";
import type { BgName, ThemeLike, WidthHelpers } from "./types.ts";

/**
 * Restores ui-overhaul's shared tool background while preserving the native
 * foreground markers rendered by Pi and pi-tool-display.
 */
export type ToolRenderState = {
  isPartial?: boolean;
  isError?: boolean;
};

function toolNameLabel(toolName: unknown): string {
  return typeof toolName === "string" && toolName.trim().length > 0 ? toolName.trim() : "unknown";
}

function toolTitle(toolName: unknown, theme: ThemeLike | undefined): string {
  const raw = ` tool(${toolNameLabel(toolName)})`;
  const bold = theme?.bold ? theme.bold(raw) : raw;
  return styled(bold, "bashMode", theme);
}

function toolBackground(
  toolName: unknown,
  state: ToolRenderState | undefined,
): "toolPendingBg" | "toolSuccessBg" | "toolErrorBg" {
  if (toolName === "edit" || toolName === "write" || state?.isPartial) return "toolPendingBg";
  return state?.isError ? "toolErrorBg" : "toolSuccessBg";
}

function isNestedFrameLine(line: string): boolean {
  const plain = stripAnsi(line).trim();
  return /^[╭╰].*[╮╯]$/u.test(plain);
}

function compactToolLines(lines: string[], helpers: WidthHelpers): string[] {
  return lines.filter(
    (line) => !isVisiblyBlank(line, helpers) && !isSeparatorLine(line) && !isNestedFrameLine(line),
  );
}

function border(text: string, theme: ThemeLike | undefined): string {
  return styled(text, "success", theme);
}

/**
 * Restores ui-overhaul's outer tool card while leaving the inner content owned
 * by Pi's original ToolExecutionComponent (and therefore pi-tool-display).
 */
export function renderToolMessage(
  toolName: unknown,
  lines: string[],
  width: number,
  theme: ThemeLike | undefined,
  helpers: WidthHelpers,
  state?: ToolRenderState,
): string[] {
  if (width < 2) {
    return [themedBackground(toolTitle(toolName, theme), Math.max(0, width), toolBackground(toolName, state), theme, helpers)];
  }

  const cardWidth = width;
  const innerWidth = cardWidth - 2;
  const background = toolBackground(toolName, state);
  const compactedLines = compactToolLines(lines, helpers);
  const visibleLines =
    ["hypa_read", "hypa_grep", "hypa_find", "hypa_ls", "hypa_shell"].includes(toolName as string) && state?.isPartial !== true
      ? compactedLines.slice(0, 1)
      : compactedLines;
  const body = visibleLines.map((line) => {
    const content = themedBackground(line, innerWidth, background, theme, helpers);
    const side = themedBackground(border("│", theme), 1, background, theme, helpers);
    return `${side}${content}${side}`;
  });

  const title = helpers.truncateToWidth(` ${toolTitle(toolName, theme)} `, innerWidth, "", false);
  const titleWidth = helpers.visibleWidth(title);
  const top = `${border("╭", theme)}${title}${border("─".repeat(Math.max(0, innerWidth - titleWidth)), theme)}${border("╮", theme)}`;
  const bottom = `${border("╰", theme)}${border("─".repeat(innerWidth), theme)}${border("╯", theme)}`;

  return [
    "",
    themedBackground(top, cardWidth, background, theme, helpers),
    ...body,
    themedBackground(bottom, cardWidth, background, theme, helpers),
  ];
}
