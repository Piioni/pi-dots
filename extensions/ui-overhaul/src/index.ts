import {
  copyToClipboard,
  getSelectListTheme,
  type ExtensionAPI,
  type ExtensionCommandContext,
  AssistantMessageComponent,
  ToolExecutionComponent,
  UserMessageComponent,
} from "@earendil-works/pi-coding-agent";
import { Marked, Markdown, MouseRegion, SelectList } from "@earendil-works/pi-tui";
import { setMarkedLexer } from "./code-blocks.ts";
import { copyCodeBlock, registerCodeCopyCommand } from "./code-copy.ts";
import { registerUiOverhaulLifecycle } from "./lifecycle.ts";
import {
  assistantSourceRegistry,
  getCurrentContext,
  getRuntimeGeneration,
  type PatchedPrototype,
} from "./state.ts";
import { terminalWidthHelpers } from "./terminal.ts";
import type { AssistantCodeBlock, Renderable } from "./types.ts";

const marked = new Marked();
const inlineCopyPending = new Set<string>();

async function selectCodeBlock(
  ctx: ExtensionCommandContext,
  blocks: readonly AssistantCodeBlock[],
): Promise<number | undefined> {
  const selected = await ctx.ui.custom<string | undefined>((tui, _theme, _keybindings, done) => {
    const selectList = new SelectList(
      blocks.map((block) => ({
        value: String(block.blockIndex),
        label: `Block ${block.blockIndex}`,
        description: `${block.info || "plain text"} — ${block.code.split(/\r?\n/u).find((line) => line.trim())?.trim() ?? "(empty)"}`,
      })),
      Math.min(blocks.length, 10),
      getSelectListTheme(),
    );
    selectList.onSelect = (item) => done(item.value);
    selectList.onCancel = () => done(undefined);
    return {
      render: (width) => selectList.render(width),
      invalidate: () => selectList.invalidate(),
      handleInput: (input) => {
        selectList.handleInput(input);
        tui.requestRender();
      },
    };
  });
  return selected === undefined ? undefined : Number(selected);
}

export default function uiOverhaulUserMessages(pi: ExtensionAPI) {
  setMarkedLexer((markdown) => marked.lexer(markdown));
  registerCodeCopyCommand(pi, assistantSourceRegistry, {
    write: copyToClipboard,
    select: selectCodeBlock,
    getGeneration: getRuntimeGeneration,
  });

  // SAFETY: These Pi runtime prototypes implement the patch contracts, but their exported declarations do not expose mutable prototype shapes.
  const userMessagePrototype = UserMessageComponent.prototype as unknown as PatchedPrototype & Renderable;
  const markdownPrototype = Markdown.prototype as unknown as PatchedPrototype & Renderable;
  const toolMessagePrototype = ToolExecutionComponent.prototype as unknown as PatchedPrototype & Renderable;
  const assistantMessagePrototype = AssistantMessageComponent.prototype as unknown as PatchedPrototype;

  registerUiOverhaulLifecycle(
    pi,
    userMessagePrototype,
    markdownPrototype,
      terminalWidthHelpers,
      toolMessagePrototype,
      assistantMessagePrototype,
      {
        onCopy: (block) => {
          const ctx = getCurrentContext();
          if (!ctx) return;
          return copyCodeBlock(block, {
            write: copyToClipboard,
            notify: ctx.ui.notify.bind(ctx.ui),
            getGeneration: getRuntimeGeneration,
            pending: inlineCopyPending,
          }).then(() => undefined);
        },
        wrapMouseRegion: (child, onMouse) => new MouseRegion(child, onMouse),
      },
    );
}
