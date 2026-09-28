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

export type FenceMarker = "`" | "~";

export type FencedBlockCandidate = {
  candidateIndex: number;
  marker: FenceMarker;
  fenceLength: number;
  info: string;
  code?: string;
  complete: boolean;
};

export type AssistantCodeBlock = FencedBlockCandidate & {
  complete: true;
  code: string;
  contentPartIndex: number;
  blockIndex: number;
  key: string;
};

export type AssistantTextPart = { type: "text"; text: string };

export type AssistantMessageLike = {
  content: readonly ({ type: string } & Partial<AssistantTextPart>)[];
};

export type RenderCacheEntry = { width: number; lines: string[] };

export type WidthHelpers = {
  truncateToWidth(line: string, width: number, ellipsis: string, preserveAnsi: boolean): string;
  visibleWidth(line: string): number;
};
