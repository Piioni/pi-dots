import { compactCwd, widthOf } from "../format.ts";

const HEADER_CWD_TARGET_RATIO = 0.55;
const HEADER_CONNECTOR = " -> ";
const HEADER_SEPARATOR = " ";
const FOOTER_RIGHT_GAP = " ";
const FOOTER_RIGHT_SEPARATOR = " • ";
const FOOTER_TOKENS_LABEL = "Tokens: ";
const FOOTER_TOKENS_SEPARATOR = " ";

export interface HeaderResponsiveInput {
  width: number;
  cwd: string;
  branch?: string;
  gitState?: string;
  gitStatus?: string;
}

export interface HeaderResponsiveDecision {
  cwd: string;
  branch?: string;
  gitState?: string;
  gitStatus?: string;
}

interface HeaderPart {
  key: "branch" | "gitState" | "gitStatus";
  text: string;
}

export function selectResponsiveHeader(input: HeaderResponsiveInput): HeaderResponsiveDecision {
  const width = Math.max(1, input.width);
  const preferredCwd = compactCwd(
    input.cwd,
    Math.max(1, Math.min(width, Math.floor(width * HEADER_CWD_TARGET_RATIO))),
  );
  const parts: HeaderPart[] = [
    input.branch ? { key: "branch", text: input.branch } : null,
    input.gitState ? { key: "gitState", text: input.gitState } : null,
    input.gitStatus ? { key: "gitStatus", text: input.gitStatus } : null,
  ].filter((part): part is HeaderPart => part !== null);

  for (let keepCount = parts.length; keepCount >= 0; keepCount -= 1) {
    const visibleParts = parts.slice(0, keepCount);
    const extrasWidth = visibleParts.length === 0
      ? 0
      : widthOf(HEADER_CONNECTOR) + widthOf(visibleParts.map((part) => part.text).join(HEADER_SEPARATOR));

    if (widthOf(preferredCwd) + extrasWidth > width) continue;

    return {
      cwd: preferredCwd,
      branch: visibleParts.find((part) => part.key === "branch")?.text,
      gitState: visibleParts.find((part) => part.key === "gitState")?.text,
      gitStatus: visibleParts.find((part) => part.key === "gitStatus")?.text,
    };
  }

  return { cwd: compactCwd(input.cwd, width) };
}

export interface FooterPrimaryResponsiveInput {
  width: number;
  left: string;
  context?: string;
  pullRequest?: string;
}

export interface FooterPrimaryResponsiveDecision {
  right: string;
  includesContext: boolean;
  includesPullRequest: boolean;
}

export function selectResponsiveFooterPrimary(
  input: FooterPrimaryResponsiveInput,
): FooterPrimaryResponsiveDecision {
  const width = Math.max(1, input.width);
  const rightParts = [input.pullRequest, input.context].filter(Boolean) as string[];
  const fullRight = rightParts.join(FOOTER_RIGHT_SEPARATOR);

  if (
    fullRight &&
    widthOf(input.left) + widthOf(FOOTER_RIGHT_GAP) + widthOf(fullRight) <= width
  ) {
    return {
      right: fullRight,
      includesContext: Boolean(input.context),
      includesPullRequest: Boolean(input.pullRequest),
    };
  }

  if (
    input.context &&
    widthOf(input.left) + widthOf(FOOTER_RIGHT_GAP) + widthOf(input.context) <= width
  ) {
    return {
      right: input.context,
      includesContext: true,
      includesPullRequest: false,
    };
  }

  return {
    right: "",
    includesContext: false,
    includesPullRequest: false,
  };
}

export type FooterTokensTier = "full" | "medium" | "small" | "tiny" | "none";

export interface FooterTokensResponsiveInput {
  width: number;
  input?: string;
  output?: string;
  cache?: string;
  cacheHit?: string;
  cost?: string;
}

export interface FooterTokensResponsiveDecision {
  tier: FooterTokensTier;
  parts: string[];
}

const FOOTER_TOKEN_TIERS: Array<{
  tier: Exclude<FooterTokensTier, "none">;
  keys: Array<keyof Omit<FooterTokensResponsiveInput, "width">>;
}> = [
  { tier: "full", keys: ["input", "output", "cache", "cacheHit", "cost"] },
  { tier: "medium", keys: ["input", "output", "cacheHit", "cost"] },
  { tier: "small", keys: ["cacheHit", "cost"] },
  { tier: "tiny", keys: ["cost"] },
];

export function selectResponsiveFooterTokens(
  input: FooterTokensResponsiveInput,
): FooterTokensResponsiveDecision {
  const width = Math.max(1, input.width);

  for (const candidate of FOOTER_TOKEN_TIERS) {
    const parts = candidate.keys
      .map((key) => input[key])
      .filter((part): part is string => Boolean(part));

    if (parts.length === 0) continue;

    const line = `${FOOTER_TOKENS_LABEL}${parts.join(FOOTER_TOKENS_SEPARATOR)}`;
    if (widthOf(line) <= width) {
      return { tier: candidate.tier, parts };
    }
  }

  if (input.cost) return { tier: "tiny", parts: [input.cost] };

  const fallbackParts = [input.input, input.output, input.cache, input.cacheHit].filter(Boolean) as string[];
  if (fallbackParts.length > 0) return { tier: "full", parts: fallbackParts };

  return { tier: "none", parts: [] };
}
