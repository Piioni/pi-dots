import { extractAssistantCodeBlocks } from "./code-blocks.ts";
import { ORIGINALS, PATCHED, type PatchedPrototype } from "./state.ts";
import type { AssistantCodeBlock, AssistantMessageLike, Renderable } from "./types.ts";

export type InlineCodeControl = {
  block: AssistantCodeBlock;
  onCopy: (block: AssistantCodeBlock) => void | Promise<void>;
};

export type MouseRegionFactory = (
  child: Renderable & { invalidate(): void },
  onMouse: (event: MouseEventLike) => { handled: true; render: true } | undefined,
) => object;

export type InlineControlTarget = {
  blockIndex: number;
  row: number;
  start: number;
  end: number;
};

type MouseEventLike = {
  type: string;
  button: string;
  x: number;
  y: number;
};

type ChildContainer = { children: unknown[] };
type MarkdownChild = Renderable & { invalidate(): void; setText: (text: string) => void };
type AssistantControlHost = PatchedPrototype & {
  children: unknown[];
  contentContainer: ChildContainer;
  updateContent?: unknown;
};

const inlineControls = new WeakMap<object, readonly InlineCodeControl[]>();
const inlineTargets = new WeakMap<object, readonly InlineControlTarget[]>();

function isContainer(value: unknown): value is ChildContainer {
  return typeof value === "object" && value !== null && Array.isArray((value as { children?: unknown }).children);
}

function isMarkdownChild(value: unknown): value is MarkdownChild {
  return typeof value === "object" && value !== null
    && typeof (value as { render?: unknown }).render === "function"
    && typeof (value as { invalidate?: unknown }).invalidate === "function"
    && typeof (value as { setText?: unknown }).setText === "function";
}

function visibleTextPartIndexes(message: AssistantMessageLike): readonly number[] {
  return message.content.flatMap((part, index) => part.type === "text" && typeof part.text === "string" && part.text.trim()
    ? [index]
    : []);
}

/**
 * Validates the installed assistant transcript shape before mutating any child.
 * This is intentionally the only module that reads the host's private child tree.
 */
export function decorateAssistantCodeControls(
  value: unknown,
  message: AssistantMessageLike,
  dependencies: Pick<InlineCodeControl, "onCopy"> & { wrapMouseRegion: MouseRegionFactory },
): boolean {
  if (typeof value !== "object" || value === null) return false;
  const host = value as Partial<AssistantControlHost>;
  if (!Array.isArray(host.children) || host.children.length !== 1 || !isContainer(host.contentContainer)) return false;
  if (host.children[0] !== host.contentContainer) return false;

  const textPartIndexes = visibleTextPartIndexes(message);
  const markdownChildren = host.contentContainer.children.filter(isMarkdownChild);
  if (markdownChildren.length !== textPartIndexes.length) return false;

  const blocksByPart = new Map<number, AssistantCodeBlock[]>();
  for (const block of extractAssistantCodeBlocks(message)) {
    const blocks = blocksByPart.get(block.contentPartIndex) ?? [];
    blocks.push(block);
    blocksByPart.set(block.contentPartIndex, blocks);
  }

  const replacements = new Map<object, object>();
  for (const [index, markdown] of markdownChildren.entries()) {
    const blocks = blocksByPart.get(textPartIndexes[index]!) ?? [];
    if (blocks.length === 0) continue;
    inlineControls.set(markdown, blocks.map((block) => ({ block, onCopy: dependencies.onCopy })));
    replacements.set(markdown, dependencies.wrapMouseRegion(markdown, (event) => activateInlineCodeControl(markdown, event)));
  }

  // Apply only after every shape and source mapping check has succeeded.
  if (replacements.size > 0) {
    host.contentContainer.children = host.contentContainer.children.map((child) => replacements.get(child as object) ?? child);
  }
  return true;
}

export function getInlineCodeControls(markdown: object): readonly InlineCodeControl[] | undefined {
  return inlineControls.get(markdown);
}

export function setInlineControlTargets(markdown: object, targets: readonly InlineControlTarget[]): void {
  inlineTargets.set(markdown, targets);
}

export function activateInlineCodeControl(
  markdown: object,
  event: MouseEventLike,
): { handled: true; render: true } | undefined {
  if (event.type !== "click" || event.button !== "left") return undefined;
  const target = inlineTargets.get(markdown)?.find((candidate) =>
    candidate.row === event.y && event.x >= candidate.start && event.x < candidate.end,
  );
  if (!target) return undefined;
  const control = inlineControls.get(markdown)?.find((candidate) => candidate.block.blockIndex === target.blockIndex);
  if (!control) return undefined;
  try {
    void control.onCopy(control.block);
  } catch {
    return undefined;
  }
  return { handled: true, render: true };
}

export function installAssistantCodeControls(
  proto: AssistantControlHost,
  dependencies: Pick<InlineCodeControl, "onCopy"> & { wrapMouseRegion: MouseRegionFactory },
): void {
  if (proto[PATCHED]) return;
  const original = proto.updateContent;
  if (typeof original !== "function") return;

  proto[ORIGINALS] = { updateContent: original };
  proto.updateContent = function patchedUpdateContent(this: AssistantControlHost, message: AssistantMessageLike, ...args: unknown[]): void {
    original.call(this, message, ...args);
    decorateAssistantCodeControls(this, message, dependencies);
  };
  proto[PATCHED] = true;
}
