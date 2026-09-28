import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import type { ExtensionAPI, ExtensionContext, ReadonlyFooterDataProvider } from "@earendil-works/pi-coding-agent";

export interface ProviderUsage {
  label: string;
  primary: number;
  secondary?: number;
}

export const CODEX_PROVIDER = "openai-codex";
export const CODEX_USAGE_URL = "https://chatgpt.com/backend-api/wham/usage";
const CODEX_ACCOUNT_CLAIM = "https://api.openai.com/auth";

interface CodexWindow {
  used_percent?: unknown;
}

interface CodexRateLimit {
  primary_window?: CodexWindow | null;
  secondary_window?: CodexWindow | null;
}

interface CodexUsagePayload {
  rate_limit?: CodexRateLimit | null;
}

export function accountIdFromToken(token: string): string | undefined {
  const parts = token.split(".");
  if (parts.length !== 3) return undefined;
  try {
    const claims = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8")) as Record<string, unknown>;
    const auth = claims[CODEX_ACCOUNT_CLAIM] as { chatgpt_account_id?: unknown } | undefined;
    return typeof auth?.chatgpt_account_id === "string" && auth.chatgpt_account_id.length > 0
      ? auth.chatgpt_account_id
      : undefined;
  } catch {
    return undefined;
  }
}

function usagePercent(window: CodexWindow | null | undefined): number | undefined {
  if (typeof window?.used_percent !== "number" || !Number.isFinite(window.used_percent)) return undefined;
  return Math.max(0, Math.min(100, window.used_percent));
}

export function parseCodexUsage(payload: unknown): ProviderUsage | undefined {
  const rateLimit = (payload as CodexUsagePayload | null | undefined)?.rate_limit;
  const primary = usagePercent(rateLimit?.primary_window);
  if (primary === undefined) return undefined;
  const secondary = usagePercent(rateLimit?.secondary_window);
  return { label: "codex", primary, secondary };
}

export interface UsageStore {
  get(provider: string): ProviderUsage | undefined;
  record(provider: string, headers: Record<string, string>): boolean;
  recordCodexPayload(provider: string, payload: unknown): boolean;
}

export function createUsageStore(): UsageStore {
  const values = new Map<string, ProviderUsage>();
  return {
    get: (provider) => values.get(provider),
    recordCodexPayload(provider, payload) {
      if (provider !== CODEX_PROVIDER) return false;
      const usage = parseCodexUsage(payload);
      if (!usage) return false;
      values.set(provider, usage);
      return true;
    },
    record(provider, headers) {
      const normalized = new Map(Object.entries(headers).map(([key, value]) => [key.toLowerCase(), value]));
      const readPercent = (key: string, fraction = false): number | undefined => {
        const raw = normalized.get(key);
        if (raw === undefined) return undefined;
        const parsed = Number.parseFloat(raw);
        if (!Number.isFinite(parsed)) return undefined;
        const percent = fraction ? parsed * 100 : parsed;
        return Math.max(0, Math.min(100, percent));
      };
      const isCodex = normalized.has("x-codex-primary-used-percent");
      const isClaude = normalized.has("anthropic-ratelimit-unified-5h-utilization");
      if (!isCodex && !isClaude) return false;
      const primary = isCodex
        ? readPercent("x-codex-primary-used-percent")
        : readPercent("anthropic-ratelimit-unified-5h-utilization", true);
      if (primary === undefined) return false;
      const secondary = isCodex
        ? readPercent("x-codex-secondary-used-percent")
        : readPercent("anthropic-ratelimit-unified-7d-utilization", true);
      values.set(provider, {
        label: isCodex ? "codex" : "claude",
        primary,
        secondary,
      });
      return true;
    },
  };
}

export interface FooterTheme {
  fg(color: string, text: string): string;
  bold(text: string): string;
}

export interface FooterModel {
  cwd: string;
  branch: string | null;
  dirty: number;
  model: string;
  effort?: string;
  contextPercent: number | null;
  contextWindow: number;
  sessionName?: string;
  statuses: string[];
  usage?: ProviderUsage;
}

const separator = "⟡";
const gaugeCells = 8;
const home = process.env.HOME ?? "";
const ansiPattern = /[\u001B\u009B][[\]()#;?]*(?:(?:(?:[a-zA-Z\d]*(?:;[a-zA-Z\d]*)*)?\u0007)|(?:(?:\d{1,4}(?:;\d{0,4})*)?[\dA-PR-TZcf-nq-uy=><~]))/g;

function clean(value: string): string {
  return value.replace(ansiPattern, "").replace(/[\r\n\t]/g, " ").replace(/ +/g, " ").trim();
}

function shortenHome(cwd: string): string {
  return home && cwd.startsWith(home) ? `~${cwd.slice(home.length)}` : cwd;
}

function renderGauge(percent: number | null, theme: FooterTheme): string {
  const filled = percent === null ? 0 : Math.round(Math.max(0, Math.min(100, percent)) / 100 * gaugeCells);
  const cells = "▰".repeat(filled) + "▱".repeat(gaugeCells - filled);
  return theme.fg(percent !== null && percent >= 85 ? "warning" : "accent", cells);
}

function renderUsage(usage: ProviderUsage, theme: FooterTheme): string {
  const bar = (percent: number) => {
    const filled = Math.round(percent / 100 * gaugeCells);
    return "▰".repeat(filled) + "▱".repeat(gaugeCells - filled);
  };
  const primary = `${theme.fg("muted", `${usage.label} `)}${theme.fg("accent", bar(usage.primary))}${theme.fg("muted", ` ${Math.round(usage.primary)}%`)}`;
  if (usage.secondary === undefined) return primary;
  return `${primary}${theme.fg("muted", ` · week ${Math.round(usage.secondary)}%`)}`;
}

export function buildFooterModel(
  pi: ExtensionAPI,
  ctx: ExtensionContext,
  footerData: ReadonlyFooterDataProvider,
  dirty: number,
  usage: ProviderUsage | undefined,
): FooterModel {
  const context = ctx.getContextUsage();
  const model = ctx.model;
      const statuses = Array.from(footerData.getExtensionStatuses().entries())
        .filter(([key]) => key !== "engram")
        .map(([, status]) => String(status))
        .sort((a, b) => a.localeCompare(b));
  return {
    cwd: shortenHome(ctx.sessionManager.getCwd()),
    branch: footerData.getGitBranch(),
    dirty,
    model: model?.id ?? "no-model",
    effort: model?.reasoning ? pi.getThinkingLevel() : undefined,
    contextPercent: context?.percent ?? null,
    contextWindow: context?.contextWindow ?? model?.contextWindow ?? 0,
    sessionName: ctx.sessionManager.getSessionName(),
    statuses,
    usage,
  };
}

function segments(model: FooterModel, theme: FooterTheme): string[] {
  const dirty = model.dirty ? ` ${theme.fg("warning", `±${model.dirty}`)}` : "";
  const location = model.branch
    ? `${theme.fg("accent", model.cwd)} ${theme.fg("text", model.branch)}${dirty}`
    : `${theme.fg("accent", model.cwd)}${dirty}`;
  const modelSegment = model.effort
    ? `${theme.fg("text", model.model)} ${theme.fg("muted", "·")} ${theme.fg("syntaxFunction", model.effort)}`
    : theme.fg("text", model.model);
  const percent = model.contextPercent === null ? "?%" : `${Math.round(model.contextPercent)}%`;
  const context = `${theme.fg("muted", "ctx")} ${renderGauge(model.contextPercent, theme)} ${theme.fg("text", percent)}`;
  return [
    theme.fg("accent", "✿"),
    location,
    modelSegment,
    context,
    ...(model.usage ? [renderUsage(model.usage, theme)] : []),
    ...model.statuses.map((status) => theme.fg("muted", clean(status))),
  ];
}

function join(parts: string[], theme: FooterTheme): string {
  return parts.reduce((result, part, index) => {
if (index === 0) return part;
if (index === 1) return `${result} ${part}`;
return `${result} ${theme.fg("dim", separator)} ${part}`;
  }, "");
}

export function renderFooter(model: FooterModel, theme: FooterTheme, width: number): string[] {
  let parts = segments(model, theme);
  let left = join(parts, theme);
  const right = model.sessionName ? theme.fg("dim", clean(model.sessionName)) : "";
  if (right && visibleWidth(left) + visibleWidth(right) + 2 <= width) {
    return [`${left}${" ".repeat(width - visibleWidth(left) - visibleWidth(right))}${right}`];
  }
  const lastPath = model.cwd.split("/").filter(Boolean).at(-1);
  if (lastPath && visibleWidth(left) > width) {
    parts = segments({ ...model, cwd: lastPath, branch: model.branch && visibleWidth(model.branch) > 15 ? `${model.branch.slice(0, 14)}…` : model.branch }, theme);
    left = join(parts, theme);
  }
  while (parts.length > 1 && visibleWidth(left) > width) {
    parts.pop();
    left = join(parts, theme);
  }
  return [truncateToWidth(left, Math.max(0, width), "…")];
}
