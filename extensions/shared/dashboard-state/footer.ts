import type { DashboardExtensionsSnapshot, DashboardStatusPart } from "./types";

export interface FooterStatusProvider {
  getExtensionStatuses(): ReadonlyMap<string, string>;
}

const LSP_ID_ALIASES: Record<string, string> = {
  basedpyright: "pyright",
  javascript: "js",
  python: "py",
  typescript: "ts",
};

function statusValue(statuses: ReadonlyMap<string, string>, key: string): string | undefined {
  const value = statuses.get(key)?.trim();
  return value || undefined;
}

function stripAnsi(text: string): string {
  return text.replace(/\u001b\[[0-9;]*m/g, "");
}

function cleanStatus(raw: string): string {
  return stripAnsi(raw).trim();
}

function normalizeLspId(id: string): string {
  const clean = id.trim().replace(/\.+$/, "");
  return LSP_ID_ALIASES[clean.toLowerCase()] ?? clean;
}

function parseLspIds(raw: string): string[] {
  return raw
    .split(/[,/]/)
    .map(normalizeLspId)
    .filter(Boolean);
}

function parseMcpStatus(raw: string | undefined): DashboardStatusPart | undefined {
  if (!raw) return undefined;

  const clean = cleanStatus(raw);
  const servers = clean.match(/^MCP:\s*(\d+)\/(\d+)\s+servers?$/i);
  if (servers) {
    const connected = Number(servers[1]);
    const total = Number(servers[2]);
    return {
      text: `MCP ${connected}/${total}`,
      tone: connected === total && total > 0 ? "success" : total === 0 ? "dim" : "accent",
    };
  }

  if (/^MCP:\s*connecting\b/i.test(clean)) {
    return { text: "MCP connecting", tone: "accent" };
  }

  return { text: clean.replace(/^MCP:\s*/i, "MCP "), tone: "dim" };
}

function parseMcpAuthStatus(raw: string | undefined): DashboardStatusPart | undefined {
  if (!raw) return undefined;

  const clean = cleanStatus(raw);
  if (/authenticating/i.test(clean)) return { text: "MCP auth", tone: "accent" };

  return { text: "MCP auth", tone: "accent" };
}

function parseLspStatus(raw: string | undefined): DashboardStatusPart[] {
  if (!raw) return [];

  const clean = cleanStatus(raw);
  if (/^LSP\s+Inactive$/i.test(clean)) return [{ text: "LSP inactive", tone: "dim" }];

  const active: string[] = [];
  const failed: string[] = [];

  for (const segment of clean.split(" · ")) {
    const activeMatch = segment.match(/^LSP\s+Active:\s*(.+)$/i);
    if (activeMatch) {
      active.push(...parseLspIds(activeMatch[1]));
      continue;
    }

    const failedMatch = segment.match(/^LSP\s+Failed:\s*(.+)$/i);
    if (failedMatch) failed.push(...parseLspIds(failedMatch[1]));
  }

  const parts: DashboardStatusPart[] = [];
  if (active.length) parts.push({ text: `LSP ${active.join(",")}`, tone: "success" });
  if (failed.length) {
    parts.push({
      text: active.length ? `failed: ${failed.join(",")}` : `LSP failed: ${failed.join(",")}`,
      tone: "error",
    });
  }

  return parts.length ? parts : [{ text: clean, tone: "dim" }];
}

export function buildDashboardExtensionsSnapshot(
  footerData: FooterStatusProvider,
): DashboardExtensionsSnapshot {
  const statuses = footerData.getExtensionStatuses();

  return {
    parts: [
      parseMcpStatus(statusValue(statuses, "mcp")),
      parseMcpAuthStatus(statusValue(statuses, "mcp-auth")),
      ...parseLspStatus(statusValue(statuses, "pi-lens-lsp")),
    ].filter((part): part is DashboardStatusPart => Boolean(part)),
  };
}
