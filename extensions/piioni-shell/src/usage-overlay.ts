import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { matchesKey, Key, truncateToWidth } from "@earendil-works/pi-tui";
import type { ProviderUsage, UsageStore } from "./footer.ts";

interface UsageTheme {
  fg(color: string, text: string): string;
}

function usageLine(usage: ProviderUsage, theme: UsageTheme): string {
  const bar = (percent: number) => {
    const filled = Math.round(percent / 100 * 8);
    return "▰".repeat(filled) + "▱".repeat(8 - filled);
  };
  const primary = `${theme.fg("text", `${usage.label} 5h `)}${theme.fg("accent", bar(usage.primary))}${theme.fg("text", ` ${Math.round(usage.primary)}%`)}`;
  const week = usage.secondary === undefined ? "" : theme.fg("text", ` · week ${Math.round(usage.secondary)}%`);
  return `${primary}${week}`;
}

export async function showUsageOverlay(ctx: ExtensionContext, store: UsageStore): Promise<void> {
  await ctx.ui.custom<null>((_tui, theme, _keybindings, done) => {
    const render = (width: number): string[] => {
      const usages = ["openai-codex", "anthropic"].map((provider) => store.get(provider)).filter((value): value is ProviderUsage => value !== undefined);
      const lines = [
        theme.fg("accent", theme.bold("Subscriptions")),
        "",
        ...(usages.length ? usages.map((usage) => usageLine(usage, theme)) : [theme.fg("dim", "No provider usage headers received yet.")]),
        "",
        theme.fg("dim", "Press escape or enter to close"),
      ];
      return lines.map((line) => truncateToWidth(line, width, ""));
    };
    return {
      render,
      invalidate() {},
      handleInput(data: string) {
        if (matchesKey(data, Key.escape) || matchesKey(data, Key.enter)) done(null);
      },
    };
  }, { overlay: true, overlayOptions: { width: "70%", minWidth: 52, anchor: "center" } });
}
