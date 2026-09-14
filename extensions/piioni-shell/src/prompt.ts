import { CustomEditor, type ExtensionContext, type KeybindingsManager } from "@earendil-works/pi-coding-agent";
import type { EditorTheme, TUI } from "@earendil-works/pi-tui";
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";

export const PROMPT_HINT = "type, or / for commands";

export type PromptWorkingState = Readonly<{
  active: boolean;
  message?: string;
  spinnerFrame: string;
  elapsedSeconds: number;
}>;

const petal = "✿";

function formatElapsed(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  return `${minutes}m ${remainder.toString().padStart(2, "0")}s`;
}

function frame(
  lines: string[],
  width: number,
  fg: (color: string, text: string) => string,
  working?: PromptWorkingState,
): string[] {
  const safeWidth = Math.max(0, Math.floor(width));
  if (safeWidth < 2) {
    return lines.map((_line, index) => {
      if (safeWidth === 0) return "";
      if (index === 0) return fg("border", "╭");
      if (index === lines.length - 1) return fg("border", "╰");
      return fg("border", "│");
    });
  }
  const glyph = fg("borderAccent", petal);
  const activity = working?.active && working.message
    ? `${fg("borderAccent", working.spinnerFrame)} ${fg("thinkingText", working.message)} ${fg("dim", `· ${formatElapsed(working.elapsedSeconds)}`)}`
    : "";
  const fullLabel = activity ? `${glyph} ${activity}` : glyph;
  const maxLabelWidth = Math.max(0, safeWidth - 5);
  const label = truncateToWidth(fullLabel, maxLabelWidth, "");
  const fill = safeWidth - 3 - visibleWidth(label) - 2;
  const top = fill < 0
    ? fg("border", `╭${"─".repeat(Math.max(0, safeWidth - 2))}╮`)
    : `${fg("border", "╭─ ")}${label}${fg("border", ` ${"─".repeat(fill)}╮`)}`;
  const innerWidth = safeWidth - 2;
  const body = lines.slice(1, -1).map((line) => {
    const clipped = truncateToWidth(line, innerWidth, "");
    return `${fg("border", "│")}${clipped}${" ".repeat(Math.max(0, innerWidth - visibleWidth(clipped)))}${fg("border", "│")}`;
  });
  return [top, ...body, fg("border", `╰${"─".repeat(Math.max(0, safeWidth - 2))}╯`)];
}

export class PiioniPromptEditor extends CustomEditor {
  constructor(
    tui: TUI,
    theme: EditorTheme,
    keybindings: KeybindingsManager,
    private readonly ctx: ExtensionContext,
    private readonly working: PromptWorkingState,
  ) {
    super(tui, theme, keybindings);
    void theme;
  }

  render(width: number): string[] {
    const lines = super.render(Math.max(1, width - 2));
    if (this.getText() === "" && lines.length === 3) {
      const cursor = "\x1b[7m \x1b[0m";
      const index = lines[1].indexOf(cursor);
      if (index !== -1 && lines[1].slice(index + cursor.length).trim() === "") {
        lines[1] = `${lines[1].slice(0, index + cursor.length)} ${this.ctx.ui.theme.fg("dim", PROMPT_HINT)}${lines[1].slice(index + cursor.length + 1 + PROMPT_HINT.length)}`;
      }
    }
    return frame(
      lines,
      width,
      (color, text) => this.ctx.ui.theme.fg(color as Parameters<typeof this.ctx.ui.theme.fg>[0], text),
      this.working,
    );
  }
}
