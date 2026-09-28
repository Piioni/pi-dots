import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { InlineCodeControl, MouseRegionFactory } from "./assistant-code-controls.ts";
import { installAssistantCodeControls } from "./assistant-code-controls.ts";
import {
  installMarkdownPatch,
  installToolMessagePatch,
  installUserMessagePatch,
  restore,
} from "./prototype-patches.ts";
import {
  assistantSourceRegistry,
  resetCodeCopyState,
  resetRenderCache,
  setCurrentContext,
  type PatchedPrototype,
} from "./state.ts";
import type { AssistantMessageLike, Renderable, WidthHelpers } from "./types.ts";

export type InlineCodeControlsRuntime = {
  onCopy: InlineCodeControl["onCopy"];
  wrapMouseRegion: MouseRegionFactory;
};

export function registerUiOverhaulLifecycle(
  pi: ExtensionAPI,
  userMessagePrototype: PatchedPrototype & Renderable,
  markdownPrototype: PatchedPrototype & Renderable,
  helpers: WidthHelpers,
  toolMessagePrototype?: PatchedPrototype & Renderable,
  assistantMessagePrototype?: PatchedPrototype,
  inlineCodeControls: InlineCodeControlsRuntime = {
    onCopy: () => {},
    wrapMouseRegion: (child) => child,
  },
): void {
  pi.on("session_start", async (_event, ctx) => {
    if (!ctx.hasUI || ctx.mode !== "tui") return;
    resetCodeCopyState();
    setCurrentContext(ctx);
    installUserMessagePatch(userMessagePrototype, helpers);
    installMarkdownPatch(markdownPrototype, helpers);
    if (assistantMessagePrototype) installAssistantCodeControls(assistantMessagePrototype as never, inlineCodeControls);
    if (toolMessagePrototype) installToolMessagePatch(toolMessagePrototype, helpers);
  });

  pi.on("message_start", async (event) => {
    if (event.message.role === "assistant") assistantSourceRegistry.set(event.message as AssistantMessageLike);
  });

  pi.on("message_update", async (event) => {
    if (event.message.role === "assistant") assistantSourceRegistry.set(event.message as AssistantMessageLike);
  });

  pi.on("message_end", async (event) => {
    if (event.message.role === "assistant") assistantSourceRegistry.set(event.message as AssistantMessageLike);
  });

  pi.on("session_tree", async () => {
    assistantSourceRegistry.clear();
  });

  pi.on("session_shutdown", async () => {
    restore(userMessagePrototype);
    restore(markdownPrototype);
    if (assistantMessagePrototype) restore(assistantMessagePrototype);
    if (toolMessagePrototype) restore(toolMessagePrototype);
    resetRenderCache();
    resetCodeCopyState();
    setCurrentContext(undefined);
  });
}
