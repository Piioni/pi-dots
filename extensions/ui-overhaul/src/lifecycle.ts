import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import {
  installMarkdownPatch,
  installUserMessagePatch,
  restore,
} from "./prototype-patches.ts";
import { resetRenderCache, setCurrentContext, type PatchedPrototype } from "./state.ts";
import type { Renderable, WidthHelpers } from "./types.ts";

export function registerUiOverhaulLifecycle(
  pi: ExtensionAPI,
  userMessagePrototype: PatchedPrototype & Renderable,
  markdownPrototype: PatchedPrototype & Renderable,
  helpers: WidthHelpers,
): void {
  pi.on("session_start", async (_event, ctx) => {
    if (!ctx.hasUI || ctx.mode !== "tui") return;
    setCurrentContext(ctx);
    installUserMessagePatch(userMessagePrototype, helpers);
    installMarkdownPatch(markdownPrototype, helpers);
  });

  pi.on("session_shutdown", async () => {
    restore(userMessagePrototype);
    restore(markdownPrototype);
    resetRenderCache();
    setCurrentContext(undefined);
  });
}
