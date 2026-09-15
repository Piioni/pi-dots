import { isSeparatorLine, isVisiblyBlank, stripAnsi, stripBackground, styled, themedBackground } from "./rendering.ts";
import type { BgName, ThemeLike, WidthHelpers } from "./types.ts";

type DiffKind = "added" | "removed";

function diffKind(line: string): DiffKind | undefined {
  const plain = stripAnsi(line);
  const match = plain.match(/^[ \t]*(?:[│|][ \t]*)?([+-])\s*\d+\s/u);
  if (match?.[1] === "+") return "added";
  if (match?.[1] === "-") return "removed";
  return undefined;
}

function isContextRow(line: string): boolean {
  return /^[ \t]*(?:[│|][ \t]*)?\d+\s/u.test(stripAnsi(line));
}

function isContinuationRow(line: string, activeKind: DiffKind | undefined, helpers: WidthHelpers): boolean {
  if (activeKind === undefined || isVisiblyBlank(line, helpers) || isContextRow(line)) return false;
  const content = stripAnsi(line).replace(/^[ \t]*[│|][ \t]*/u, "").trim();
  if (isSeparatorLine(line) || /^[╭╰].*[╮╯]$/u.test(content)) return false;
  return content.length > 0;
}

const SGR_PATTERN = /\x1b\[[0-9;]*m/g;

function foregroundAnsiPrefix(color: string, theme: ThemeLike | undefined): string {
  if (!theme) return "";
  const marker = "__PI_UI_ANSI__";
  const styled = theme.fg(color, marker);
  const markerIndex = styled.indexOf(marker);
  return markerIndex < 0 ? "" : styled.slice(0, markerIndex);
}

function diffBackground(kind: DiffKind, theme: ThemeLike | undefined): string {
  const color = kind === "added" ? "toolDiffAdded" : "toolDiffRemoved";
  const foreground = foregroundAnsiPrefix(color, theme);
  return foreground.includes("\x1b[38;") ? foreground.replace(/\x1b\[38;/g, "\x1b[48;") : "";
}

function reapplyBackground(line: string, background: string): string {
  return line.replace(SGR_PATTERN, (sgr) => `${sgr}${background}`);
}

function highlightDiffLine(
  line: string,
  kind: DiffKind,
  width: number,
  theme: ThemeLike | undefined,
  helpers: WidthHelpers,
): string {
  const background = diffBackground(kind, theme);
  if (!background) {
    return themedBackground(line, width, kind === "added" ? "toolSuccessBg" : "toolErrorBg", theme, helpers);
  }

  const color = kind === "added" ? "toolDiffAdded" : "toolDiffRemoved";
  const diffForeground = foregroundAnsiPrefix(color, theme);
  const textForeground = foregroundAnsiPrefix("text", theme) || "\x1b[39m";
  const clean = stripBackground(line);
  const truncated = helpers.truncateToWidth(clean, Math.max(0, width), "", true);
  const safe = diffForeground
    ? truncated.replace(diffForeground, textForeground)
    : `${textForeground}${truncated}`;
  const padding = " ".repeat(Math.max(0, width - helpers.visibleWidth(safe)));
  return `${background}${reapplyBackground(safe, background)}${padding}\x1b[49m`;
}

/**
 * Applies diff-specific backgrounds after Pi's ToolExecutionComponent has rendered its normal card.
 * Core renderDiff rows retain their foreground and nested ANSI styling; only their background changes.
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

function toolBackground(state: ToolRenderState | undefined): "toolPendingBg" | "toolSuccessBg" | "toolErrorBg" {
  if (state?.isPartial) return "toolPendingBg";
  return state?.isError ? "toolErrorBg" : "toolSuccessBg";
}

function toolRowBackground(kind: DiffKind): BgName {
  return kind === "added" ? "toolSuccessBg" : "toolErrorBg";
}

function ansiBackgroundCell(line: string, width: number, background: string, helpers: WidthHelpers): string {
  const clean = stripBackground(line);
  const safe = helpers.truncateToWidth(clean, Math.max(0, width), "", true);
  const padding = " ".repeat(Math.max(0, width - helpers.visibleWidth(safe)));
  return `${background}${reapplyBackground(safe, background)}${padding}\x1b[49m`;
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
    return [themedBackground(toolTitle(toolName, theme), Math.max(0, width), toolBackground(state), theme, helpers)];
  }

  const cardWidth = width;
  const innerWidth = cardWidth - 2;
  const background = toolBackground(state);
  const isDiffTool = toolName === "edit" || toolName === "write";
  let activeKind: DiffKind | undefined;
  const compactedLines = compactToolLines(lines, helpers);
  const visibleLines =
    toolName === "hypa_read" && state?.isPartial !== true
      ? compactedLines.slice(0, 1)
      : compactedLines;
  const body = visibleLines.map((line) => {
    if (isDiffTool) {
      const currentKind = diffKind(line);
      if (currentKind) activeKind = currentKind;
      else if (!isContinuationRow(line, activeKind, helpers)) activeKind = undefined;
    } else {
      activeKind = undefined;
    }

    const rowBackground = activeKind ? toolRowBackground(activeKind) : background;
    const content = activeKind
      ? highlightDiffLine(line, activeKind, innerWidth, theme, helpers)
      : themedBackground(line, innerWidth, background, theme, helpers);
    const diffRowBackground = activeKind ? diffBackground(activeKind, theme) : "";
    const side = diffRowBackground
      ? ansiBackgroundCell(border("│", theme), 1, diffRowBackground, helpers)
      : themedBackground(border("│", theme), 1, rowBackground, theme, helpers);
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
