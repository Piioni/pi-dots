export type BgName =
  | "userMessageBg"
  | "customMessageBg"
  | "toolPendingBg"
  | "toolSuccessBg"
  | "toolErrorBg"
  | "selectedBg";

export type ThemeLike = {
  bg(color: BgName, text: string): string;
  fg(color: string, text: string): string;
  bold?(text: string): string;
  getBgAnsi?(color: BgName): string;
};

export type Renderable = { render(width: number): string[] };

export type RenderCacheEntry = { width: number; lines: string[] };

export type WidthHelpers = {
  truncateToWidth(line: string, width: number, ellipsis: string, preserveAnsi: boolean): string;
  visibleWidth(line: string): number;
};
