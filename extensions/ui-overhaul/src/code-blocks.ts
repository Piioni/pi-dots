import type { AssistantCodeBlock, AssistantMessageLike, FencedBlockCandidate } from "./types.ts";

type MarkedCodeToken = {
  type: string;
  raw: string;
  text?: string;
  lang?: string;
  codeBlockStyle?: string;
  tokens?: readonly MarkedToken[];
  items?: readonly { tokens: readonly MarkedToken[] }[];
};

type MarkedToken = MarkedCodeToken;
type MarkedLexer = (markdown: string) => readonly MarkedToken[];

let markedLexer: MarkedLexer | undefined;

export type FenceLine = {
  marker: "`" | "~";
  length: number;
  info: string;
};

export function setMarkedLexer(lexer: MarkedLexer | undefined): void {
  markedLexer = lexer;
}

export function parseFenceLine(raw: string): FenceLine | undefined {
  const line = raw.split(/\r?\n/u, 1)[0] ?? raw;
  const match = line.match(/^(?: {0,3})(`{3,}|~{3,})([^\r\n]*)$/u);
  if (!match) return undefined;
  return {
    marker: match[1]![0] as "`" | "~",
    length: match[1]!.length,
    info: match[2]!.trim(),
  };
}

export function isClosingFenceLine(raw: string, marker: "`" | "~", length: number): boolean {
  const line = raw.split(/\r?\n/u, 1)[0] ?? raw;
  const match = line.match(/^[ \\t]*([`~]+)[ \\t]*$/u);
  return match?.[1]?.[0] === marker && match[1].length >= length;
}

function closingFence(raw: string, marker: "`" | "~", length: number): boolean {
  return raw.split(/\r?\n/u).slice(1).some((line) => isClosingFenceLine(line, marker, length));
}

function collectCodeTokens(tokens: readonly MarkedToken[], found: MarkedCodeToken[]): void {
  for (const token of tokens) {
    if (token.type === "code") {
      found.push(token);
      continue;
    }
    if (token.type === "list" && token.items) {
      for (const item of token.items) collectCodeTokens(item.tokens, found);
      continue;
    }
    if (token.tokens) collectCodeTokens(token.tokens, found);
  }
}

function scanMarkedFences(markdown: string): readonly FencedBlockCandidate[] | undefined {
  if (!markedLexer) return undefined;
  const tokens: MarkedCodeToken[] = [];
  collectCodeTokens(markedLexer(markdown), tokens);
  const candidates: FencedBlockCandidate[] = [];
  for (const token of tokens) {
    if (token.codeBlockStyle === "indented") continue;
    const fence = parseFenceLine(token.raw);
    if (!fence) continue;
    const candidateIndex = candidates.length;
    const complete = closingFence(token.raw, fence.marker, fence.length);
    candidates.push(complete
      ? { candidateIndex, marker: fence.marker, fenceLength: fence.length, info: fence.info, code: token.text ?? "", complete }
      : { candidateIndex, marker: fence.marker, fenceLength: fence.length, info: fence.info, complete });
  }
  return candidates;
}

function withoutBlockquotePrefix(line: string): string {
  return line.replace(/^(?: {0,3}> ?)+/u, "");
}

function scanFallbackFences(markdown: string): readonly FencedBlockCandidate[] {
  const candidates: FencedBlockCandidate[] = [];
  const lines = markdown.split(/\r?\n/u);
  let open: { marker: "`" | "~"; length: number; info: string; indent: string; body: string[] } | undefined;

  for (const sourceLine of lines) {
    const line = withoutBlockquotePrefix(sourceLine);
    if (!open) {
      const fence = parseFenceLine(line);
      if (!fence) continue;
      open = {
        marker: fence.marker,
        length: fence.length,
        info: fence.info,
        indent: line.slice(0, line.length - line.trimStart().length),
        body: [],
      };
      continue;
    }

    const deindented = line.startsWith(open.indent) ? line.slice(open.indent.length) : line;
    if (isClosingFenceLine(deindented, open.marker, open.length)) {
      candidates.push({
        candidateIndex: candidates.length,
        marker: open.marker,
        fenceLength: open.length,
        info: open.info,
        code: open.body.join("\n"),
        complete: true,
      });
      open = undefined;
      continue;
    }
    open.body.push(deindented);
  }

  if (open) {
    candidates.push({
      candidateIndex: candidates.length,
      marker: open.marker,
      fenceLength: open.length,
      info: open.info,
      complete: false,
    });
  }
  return candidates;
}

export function scanFencedBlocks(markdown: string): readonly FencedBlockCandidate[] {
  try {
    return scanMarkedFences(markdown) ?? scanFallbackFences(markdown);
  } catch {
    return [];
  }
}

export function extractAssistantCodeBlocks(message: AssistantMessageLike): readonly AssistantCodeBlock[] {
  const blocks: AssistantCodeBlock[] = [];
  for (const [contentPartIndex, part] of message.content.entries()) {
    if (part.type !== "text" || typeof part.text !== "string") continue;
    for (const candidate of scanFencedBlocks(part.text)) {
      if (!candidate.complete || candidate.code === undefined) continue;
      blocks.push({
        candidateIndex: candidate.candidateIndex,
        marker: candidate.marker,
        fenceLength: candidate.fenceLength,
        info: candidate.info,
        complete: true,
        code: candidate.code,
        contentPartIndex,
        blockIndex: blocks.length + 1,
        key: `${contentPartIndex}:${candidate.candidateIndex}`,
      });
    }
  }
  return blocks;
}
