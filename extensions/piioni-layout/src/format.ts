import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";

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
