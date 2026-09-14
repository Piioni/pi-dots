import { isClosingFenceLine, parseFenceLine } from "./code-blocks.ts";
import { GENERIC_CODE_ICON, getLanguageIcon } from "./language-icons.ts";
import { normalizeContentLine, styled, stripAnsi, themedBackground } from "./rendering.ts";
import type { InlineCodeControl, InlineControlTarget } from "./assistant-code-controls.ts";
import type { ThemeLike, WidthHelpers } from "./types.ts";

export type CodeBlockRenderResult = {
  lines: string[];
  targets: InlineControlTarget[];
};

function codeBlockHeader(
  boxWidth: number,
  language: string,
  control: InlineCodeControl | undefined,
  theme: ThemeLike | undefined,
  helpers: WidthHelpers,
): { line: string; targetStart?: number; targetEnd?: number } {
  const border = (text: string) => styled(text, "mdCodeBlockBorder", theme);
  const icon = language ? getLanguageIcon(language) ?? GENERIC_CODE_ICON : "";
  const labelSource = language ? ` ${icon} ${language} ` : "";
  const copyLabel = control && boxWidth >= 8 ? " Copy " : "";

  if (!copyLabel) {
    const label = helpers.truncateToWidth(labelSource, Math.max(0, boxWidth - 4), "", false);
    const labelWidth = helpers.visibleWidth(label);
    const horizontal = "─".repeat(Math.max(1, boxWidth - 2 - labelWidth));
    return { line: `${border("╭")}${label ? styled(label, "borderAccent", theme) : ""}${border(`${horizontal}╮`)}` };
  }

  const copyWidth = helpers.visibleWidth(copyLabel);
  const label = helpers.truncateToWidth(labelSource, Math.max(0, boxWidth - 3 - copyWidth), "", false);
  const labelWidth = helpers.visibleWidth(label);
  const horizontal = "─".repeat(Math.max(0, boxWidth - 2 - labelWidth - copyWidth));
  const targetStart = 1 + labelWidth + horizontal.length;
  return {
    line: `${border("╭")}${label ? styled(label, "borderAccent", theme) : ""}${border(horizontal)}${styled(copyLabel, "accent", theme)}${border("╮")}`,
    targetStart,
    targetEnd: targetStart + copyWidth,
  };
}

export function renderCodeBlocksWithControls(
  lines: string[],
  width: number,
  theme: ThemeLike | undefined,
  helpers: WidthHelpers,
  controls: readonly InlineCodeControl[] | undefined,
): CodeBlockRenderResult {
  const rendered: string[] = [];
  const targets: InlineControlTarget[] = [];
  const boxWidth = Math.max(4, width);
  const innerWidth = Math.max(0, boxWidth - 2);
  const contentWidth = Math.max(0, innerWidth - 2);
  const border = (text: string) => styled(text, "mdCodeBlockBorder", theme);
  const codeBackground = (line: string) => themedBackground(line, boxWidth, "toolPendingBg", theme, helpers);
  let codeLines: string[] = [];
  let codeBlockLanguage = "";
  let codeBlockPadding = 0;
  let codeBlockMarker: "`" | "~" | undefined;
  let codeBlockLength = 0;
  let insideCodeBlock = false;
  let completeControlIndex = 0;

  const flushCodeBlock = (complete: boolean) => {
    const control = complete ? controls?.[completeControlIndex++] : undefined;
    const header = codeBlockHeader(boxWidth, codeBlockLanguage, control, theme, helpers);
    const headerRow = rendered.length;
    rendered.push(codeBackground(header.line));
    if (control && header.targetStart !== undefined && header.targetEnd !== undefined) {
      targets.push({
        blockIndex: control.block.blockIndex,
        row: headerRow,
        start: header.targetStart,
        end: header.targetEnd,
      });
    }

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

    rendered.push(codeBackground(border(`╰${"─".repeat(Math.max(0, boxWidth - 2))}╯`)));
    codeLines = [];
    codeBlockLanguage = "";
    codeBlockPadding = 0;
    codeBlockMarker = undefined;
    codeBlockLength = 0;
  };

  for (const line of lines) {
    const plain = stripAnsi(normalizeContentLine(line));
    const trimmed = plain.trim();
    const fenceCandidate = trimmed[0] === "`" || trimmed[0] === "~" ? parseFenceLine(plain) : undefined;

    if (!insideCodeBlock && fenceCandidate) {
      insideCodeBlock = true;
      codeBlockMarker = fenceCandidate.marker;
      codeBlockLength = fenceCandidate.length;
      codeBlockLanguage = fenceCandidate.info;
      codeBlockPadding = plain.length - plain.trimStart().length;
      continue;
    }

    if (insideCodeBlock && codeBlockMarker && isClosingFenceLine(plain, codeBlockMarker, codeBlockLength)) {
      flushCodeBlock(true);
      insideCodeBlock = false;
      continue;
    }

    if (insideCodeBlock) codeLines.push(line);
    else rendered.push(line);
  }

  if (insideCodeBlock) flushCodeBlock(false);
  return { lines: rendered, targets };
}

export function renderCodeBlocks(
  lines: string[],
  width: number,
  theme: ThemeLike | undefined,
  helpers: WidthHelpers,
): string[] {
  return renderCodeBlocksWithControls(lines, width, theme, helpers, undefined).lines;
}
