import type {
  DashboardExtensionsSnapshot,
  DashboardLspStatus,
  DashboardMcpStatus,
  DashboardStatusPart,
} from "./types";

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

function decodeJsonStatus(raw: string): unknown {
  try {
    return JSON.parse(cleanStatus(raw));
  } catch {
    return undefined;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isStatusState(value: unknown): value is "healthy" | "partial" | "failed" | "off" {
  return value === "healthy" || value === "partial" || value === "failed" || value === "off";
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function decodeMcpStatus(raw: string): DashboardMcpStatus | undefined {
  const value = decodeJsonStatus(raw);
  if (!isRecord(value) || !isStatusState(value.state)) return undefined;
  if (!isNonNegativeInteger(value.connected) || !isNonNegativeInteger(value.total)) return undefined;

  return { state: value.state, connected: value.connected, total: value.total };
}

function decodeLspStatus(raw: string): DashboardLspStatus | undefined {
  const value = decodeJsonStatus(raw);
  if (!isRecord(value) || !isStatusState(value.state)) return undefined;
  if (!isStringArray(value.active) || !isStringArray(value.failed)) return undefined;

  return { state: value.state, active: value.active, failed: value.failed };
}

function parseMcpStatus(raw: string | undefined): DashboardStatusPart | undefined {
  if (!raw) return undefined;

  const decoded = decodeMcpStatus(raw);
  if (decoded) {
    if (decoded.state === "off") return { text: "MCP off", tone: "dim" };
    return {
      text: `MCP ${decoded.connected}/${decoded.total}`,
      tone:
        decoded.state === "healthy"
          ? "success"
          : decoded.state === "failed"
            ? "error"
            : "accent",
    };
  }

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

function statusPartsForLsp(active: string[], failed: string[]): DashboardStatusPart[] {
  const parts: DashboardStatusPart[] = [];
  if (active.length) parts.push({ text: `LSP ${active.join(",")}`, tone: "success" });
  if (failed.length) {
    parts.push({
      text: active.length ? `failed: ${failed.join(",")}` : `LSP failed: ${failed.join(",")}`,
      tone: "error",
    });
  }
  return parts;
}

function parseLspStatus(raw: string | undefined): DashboardStatusPart[] {
  if (!raw) return [];

  const decoded = decodeLspStatus(raw);
  if (decoded) {
    if (decoded.state === "off") return [{ text: "LSP inactive", tone: "dim" }];

    const parts = statusPartsForLsp(
      decoded.active.flatMap(parseLspIds),
      decoded.failed.flatMap(parseLspIds),
    );
    if (parts.length) return parts;
    return [
      {
        text: decoded.state === "healthy" ? "LSP active" : "LSP failed",
        tone: decoded.state === "healthy" ? "success" : "error",
      },
    ];
  }

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

  const parts = statusPartsForLsp(active, failed);
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
