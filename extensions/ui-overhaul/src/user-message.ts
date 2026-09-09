import {
  BORDER_CHARS,
  isSeparatorLine,
  isVisiblyBlank,
  normalizeContentLine,
  styled,
  themedBackground,
} from "./rendering.ts";
import type { ThemeLike, WidthHelpers } from "./types.ts";

function userLabel(theme: ThemeLike | undefined): string {
  const raw = "👤 user";
  const bold = theme?.bold ? theme.bold(raw) : raw;
  return styled(bold, "accent", theme);
}

export function renderUserBox(
  lines: string[],
  width: number,
  theme: ThemeLike | undefined,
  helpers: WidthHelpers,
): string[] {
  if (width < 4) return lines;

  const innerWidth = width - 2;
  const body = lines
    .map(normalizeContentLine)
    .filter((line) => !isVisiblyBlank(line, helpers) && !isSeparatorLine(line));
  const label = ` ${userLabel(theme)} `;
  const fillWidth = Math.max(1, innerWidth - helpers.visibleWidth(label));
  const top = `${styled("╭", "accent", theme)}${label}${styled("─".repeat(fillWidth) + "╮", "accent", theme)}`;
  const bottom = styled(`╰${"─".repeat(innerWidth)}╯`, "accent", theme);
  const content = body.length > 0 ? body : [""];
  const middle = content.map((line) => {
    const safe = helpers.truncateToWidth(line.replace(BORDER_CHARS, " "), Math.max(0, innerWidth - 2), "", true);
    const padded = ` ${safe}${" ".repeat(Math.max(0, innerWidth - 2 - helpers.visibleWidth(safe)))} `;
    return `${styled("│", "accent", theme)}${padded}${styled("│", "accent", theme)}`;
  });

  return [
    "",
    themedBackground(top, width, "userMessageBg", theme, helpers),
    ...middle.map((line) => themedBackground(line, width, "userMessageBg", theme, helpers)),
    themedBackground(bottom, width, "userMessageBg", theme, helpers),
  ];
}
