import { GENERIC_CODE_ICON, getLanguageIcon } from "./language-icons.ts";
import { normalizeContentLine, styled, stripAnsi, themedBackground } from "./rendering.ts";
import type { ThemeLike, WidthHelpers } from "./types.ts";

export function renderCodeBlocks(
  lines: string[],
  width: number,
  theme: ThemeLike | undefined,
  helpers: WidthHelpers,
): string[] {
  const rendered: string[] = [];
  const boxWidth = Math.max(4, width);
  const innerWidth = Math.max(0, boxWidth - 2);
  const contentWidth = Math.max(0, innerWidth - 2);
  const border = (text: string) => styled(text, "mdCodeBlockBorder", theme);
  const codeBackground = (line: string) => themedBackground(line, boxWidth, "toolPendingBg", theme, helpers);
  let codeLines: string[] = [];
  let codeBlockLanguage = "";
  let codeBlockPadding = 0;
  let insideCodeBlock = false;

  const flushCodeBlock = () => {
    const icon = codeBlockLanguage ? getLanguageIcon(codeBlockLanguage) ?? GENERIC_CODE_ICON : "";
    const labelSource = codeBlockLanguage ? ` ${icon} ${codeBlockLanguage} ` : "";
    const label = helpers.truncateToWidth(labelSource, Math.max(0, boxWidth - 4), "", false);
    const labelWidth = helpers.visibleWidth(label);
    const horizontal = "─".repeat(Math.max(1, boxWidth - 2 - labelWidth));
    const bottomHorizontal = "─".repeat(Math.max(0, boxWidth - 2));
    const top = `${border("╭")}${label ? styled(label, "borderAccent", theme) : ""}${border(`${horizontal}╮`)}`;
    rendered.push(codeBackground(top));

    const body = codeLines.length > 0 ? codeLines : [""];
    for (const line of body) {
      const withoutOuterPadding = line.startsWith(" ".repeat(codeBlockPadding))
        ? line.slice(codeBlockPadding)
        : line;
      const content = withoutOuterPadding.replace(/ +$/u, "");
      const safe = helpers.truncateToWidth(content, contentWidth, "", true);
      const padded = ` ${safe}${" ".repeat(Math.max(0, contentWidth - helpers.visibleWidth(safe)))} `;
      const middle = `${border("│")}${padded}${border("│")}`;
      rendered.push(codeBackground(middle));
    }

    rendered.push(codeBackground(border(`╰${bottomHorizontal}╯`)));
    codeLines = [];
    codeBlockLanguage = "";
    codeBlockPadding = 0;
  };

  for (const line of lines) {
    const plain = stripAnsi(normalizeContentLine(line));
    const trimmed = plain.trim();

    if (!insideCodeBlock && trimmed.startsWith("```") && trimmed.length > 2) {
      insideCodeBlock = true;
      codeBlockLanguage = trimmed.slice(3).trim();
      codeBlockPadding = plain.length - plain.trimStart().length;
      continue;
    }

    if (insideCodeBlock && trimmed === "```") {
      flushCodeBlock();
      insideCodeBlock = false;
      continue;
    }

    if (insideCodeBlock) codeLines.push(line);
    else rendered.push(line);
  }

  if (insideCodeBlock) flushCodeBlock();
  return rendered;
}
