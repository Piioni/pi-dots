import { extractAssistantCodeBlocks } from "./code-blocks.ts";
import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import type { AssistantCodeBlock, AssistantMessageLike } from "./types.ts";

export type ClipboardWriter = (text: string) => Promise<void>;
export type Notify = (message: string, type?: "info" | "warning" | "error") => void;
export type CopyOutcome = { ok: true } | { ok: false; error: unknown } | { ok: false; skipped: true };

export class AssistantSourceRegistry {
  private latest: AssistantMessageLike | undefined;

  set(message: AssistantMessageLike): void {
    this.latest = message;
  }

  get(): AssistantMessageLike | undefined {
    return this.latest;
  }

  clear(): void {
    this.latest = undefined;
  }
}

export type CodeCopyDependencies = {
  write: ClipboardWriter;
  notify: Notify;
  getGeneration: () => number;
  pending?: Set<string>;
};

export async function copyCodeBlock(
  block: AssistantCodeBlock,
  dependencies: CodeCopyDependencies,
): Promise<CopyOutcome> {
  const pending = dependencies.pending;
  if (pending?.has(block.key)) return { ok: false, skipped: true };
  pending?.add(block.key);
  const generation = dependencies.getGeneration();
  try {
    await dependencies.write(block.code);
    if (dependencies.getGeneration() === generation) dependencies.notify(`Copied code block ${block.blockIndex}.`, "info");
    return { ok: true };
  } catch (error) {
    if (dependencies.getGeneration() === generation) dependencies.notify(`Unable to copy code block ${block.blockIndex}.`, "error");
    return { ok: false, error };
  } finally {
    pending?.delete(block.key);
  }
}

export function describeCodeBlock(block: AssistantCodeBlock): { label: string; description: string } {
  const preview = block.code.split(/\r?\n/u).find((line) => line.trim().length > 0)?.trim() ?? "(empty)";
  const description = `${block.info || "plain text"} — ${preview.slice(0, 72)}`;
  return { label: `Block ${block.blockIndex}`, description };
}

export type SessionEntryLike = { type: string; message?: unknown };

function isAssistantMessage(value: unknown): value is AssistantMessageLike {
  return typeof value === "object" && value !== null
    && (value as { role?: unknown }).role === "assistant"
    && Array.isArray((value as { content?: unknown }).content);
}

export function findLatestAssistantMessage(entries: readonly SessionEntryLike[]): AssistantMessageLike | undefined {
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const entry = entries[index];
    if (entry?.type === "message" && isAssistantMessage(entry.message)) return entry.message;
  }
  return undefined;
}

export type RunCopyCodeDependencies = CodeCopyDependencies & {
  source: AssistantSourceRegistry;
  getLatestAssistant: () => AssistantMessageLike | undefined;
  select: (blocks: readonly AssistantCodeBlock[]) => Promise<number | undefined>;
};

export type CodeCopyCommandRuntime = {
  write: ClipboardWriter;
  select: (ctx: ExtensionCommandContext, blocks: readonly AssistantCodeBlock[]) => Promise<number | undefined>;
  getGeneration: () => number;
};

export function registerCodeCopyCommand(
  pi: ExtensionAPI,
  source: AssistantSourceRegistry,
  runtime: CodeCopyCommandRuntime,
): void {
  pi.registerCommand("copy-code", {
    description: "Copy a complete fenced code block from the latest assistant message",
    handler: async (args, ctx) => {
      await runCopyCodeCommand(args, {
        source,
        getLatestAssistant: () => findLatestAssistantMessage(ctx.sessionManager.buildContextEntries()),
        write: runtime.write,
        notify: ctx.ui.notify.bind(ctx.ui),
        select: (blocks) => runtime.select(ctx, blocks),
        getGeneration: runtime.getGeneration,
      });
    },
  });
}

export async function runCopyCodeCommand(args: string, dependencies: RunCopyCodeDependencies): Promise<void> {
  const message = dependencies.source.get() ?? dependencies.getLatestAssistant();
  const blocks = message ? extractAssistantCodeBlocks(message) : [];
  if (blocks.length === 0) {
    dependencies.notify("No complete fenced code blocks in the latest assistant message.", "info");
    return;
  }

  const input = args.trim();
  let selected: AssistantCodeBlock | undefined;
  if (input.length > 0) {
    if (!/^[1-9]\d*$/u.test(input)) {
      dependencies.notify("Usage: /copy-code [number]", "error");
      return;
    }
    selected = blocks[Number(input) - 1];
    if (!selected) {
      dependencies.notify(`Code block ${input} is not available.`, "error");
      return;
    }
  } else if (blocks.length === 1) {
    selected = blocks[0];
  } else {
    const selectedIndex = await dependencies.select(blocks);
    if (selectedIndex === undefined) return;
    selected = blocks[selectedIndex - 1];
    if (!selected) return;
  }

  await copyCodeBlock(selected, dependencies);
}
