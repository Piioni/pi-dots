import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";

export function stripAnsi(text: string): string {
  return text.replace(/\u001b\[[0-9;]*m/g, "");
}

export function widthOf(text: string): number {
  return visibleWidth(text);
}

export function truncate(text: string, maxWidth: number): string {
  return truncateToWidth(text, maxWidth, "…");
}

export function compactCwd(cwd: string, maxWidth: number): string {
  const home = process.env.HOME;
  const display = home && cwd.startsWith(`${home}/`) ? `~/${cwd.slice(home.length + 1)}` : cwd;
  if (display.length <= maxWidth) return display;

  const parts = display.split("/").filter(Boolean);
  const prefix = display.startsWith("~/") ? "~/" : display.startsWith("/") ? "/" : "";

  for (let keep = Math.min(parts.length, 4); keep > 0; keep -= 1) {
    const candidate = `${prefix}…/${parts.slice(-keep).join("/")}`;
    if (candidate.length <= maxWidth) return candidate;
  }

  return truncate(display, maxWidth);
}

export function formatTokens(value: number | null | undefined): string {
  if (typeof value !== "number" || !Number.isFinite(value)) return "?";
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}m`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}k`;
  return `${value}`;
}

export function formatCost(value: number | null | undefined): string {
  if (typeof value !== "number" || !Number.isFinite(value)) return "?.???";
  return value.toFixed(3);
}
