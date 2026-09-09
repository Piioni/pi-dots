import type { BgName, ThemeLike, WidthHelpers } from "./types.ts";

const ANSI_PATTERN = /[\u001B\u009B][[\]()#;?]*(?:(?:(?:[a-zA-Z\d]*(?:;[a-zA-Z\d]*)*)?\u0007)|(?:(?:\d{1,4}(?:;\d{0,4})*)?[\dA-PR-TZcf-nq-uy=><~]))/g;
const BG_PATTERN = /\x1b\[(?:48;2;\d+;\d+;\d+|48;5;\d+|49)m/g;
const SGR_PATTERN = /\x1b\[[0-9;]*m/g;
export const BORDER_CHARS = /[╭╮╰╯─│]/g;
const OSC_PROMPT_CONTROL_SEQUENCE_PATTERN = /\x1b\](?:133|633);[A-Z](?:;[^\x07\x1b]*)?(?:\x07|\x1b\\)/g;

export function stripBackground(line: string): string {
  return line.replace(BG_PATTERN, "");
}

export function normalizeContentLine(line: string): string {
  return line.replace(OSC_PROMPT_CONTROL_SEQUENCE_PATTERN, "");
}

export function stripAnsi(line: string): string {
  return line.replace(ANSI_PATTERN, "");
}

export function isVisiblyBlank(line: string, width: WidthHelpers): boolean {
  const plain = stripAnsi(normalizeContentLine(line));
  return width.visibleWidth(plain) === 0 || plain.trim() === "";
}

export function isSeparatorLine(line: string): boolean {
  const plain = stripAnsi(normalizeContentLine(line)).trim();
  return plain.length >= 8 && /^[━─═╾╼╍╎┄┈\s]+$/u.test(plain);
}

export function padToWidth(line: string, width: number, helpers: WidthHelpers): string {
  const safe = helpers.truncateToWidth(line, Math.max(0, width), "", true);
  return safe + " ".repeat(Math.max(0, width - helpers.visibleWidth(safe)));
}

function backgroundAnsi(color: BgName, theme: ThemeLike | undefined): string {
  if (!theme) return "";
  if (typeof theme.getBgAnsi === "function") return theme.getBgAnsi(color);
  const marker = "__PI_UI_BG__";
  return theme.bg(color, marker).split(marker)[0] ?? "";
}

export function themedBackground(
  line: string,
  width: number,
  color: BgName,
  theme: ThemeLike | undefined,
  helpers: WidthHelpers,
): string {
  const start = backgroundAnsi(color, theme);
  if (!start) return padToWidth(line, width, helpers);

  const clean = stripBackground(line);
  const safe = helpers.truncateToWidth(clean, Math.max(0, width), "", true);
  const padding = " ".repeat(Math.max(0, width - helpers.visibleWidth(safe)));
  return `${start}${safe.replace(SGR_PATTERN, (sgr: string) => `${sgr}${start}`)}${padding}\x1b[49m`;
}

export function styled(text: string, color: string, theme: ThemeLike | undefined): string {
  return theme?.fg(color, text) ?? text;
}
