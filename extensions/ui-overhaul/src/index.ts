import {
  UserMessageComponent,
  type ExtensionAPI,
} from "@earendil-works/pi-coding-agent";
import { Markdown } from "@earendil-works/pi-tui";
import { registerUiOverhaulLifecycle } from "./lifecycle.ts";
import { type PatchedPrototype } from "./state.ts";
import { terminalWidthHelpers } from "./terminal.ts";
import type { Renderable } from "./types.ts";

export default function uiOverhaulUserMessages(pi: ExtensionAPI) {
  const userMessagePrototype = UserMessageComponent.prototype as unknown as PatchedPrototype & Renderable;
  const markdownPrototype = Markdown.prototype as unknown as PatchedPrototype & Renderable;

  registerUiOverhaulLifecycle(
    pi,
    userMessagePrototype,
    markdownPrototype,
    terminalWidthHelpers,
  );
}
