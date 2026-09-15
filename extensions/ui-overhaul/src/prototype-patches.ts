import {
  getInlineCodeControls,
  setInlineControlTargets,
  type InlineCodeControl,
  type InlineControlTarget,
} from "./assistant-code-controls.ts";
import { renderCodeBlocksWithControls } from "./markdown.ts";
import { getTheme, ORIGINALS, PATCHED, type PatchedPrototype } from "./state.ts";
import { renderToolMessage } from "./tool-message.ts";
import { renderUserBox } from "./user-message.ts";
import type { Renderable, ThemeLike, WidthHelpers } from "./types.ts";

type ToolRenderTarget = Renderable & {
  toolName?: unknown;
  isPartial?: unknown;
  result?: { isError?: unknown };
};

type ToolRenderCacheEntry = {
  width: number;
  toolName: unknown;
  isPartial: boolean;
  isError: boolean;
  theme: ThemeLike | undefined;
  lines: string[];
};

type RenderCacheEntry = {
  width: number;
  theme: ThemeLike | undefined;
  lines: string[];
};

type MarkdownRenderCacheEntry = RenderCacheEntry & {
  controls: readonly InlineCodeControl[] | undefined;
  targets: readonly InlineControlTarget[];
};

let toolRenderCache = new WeakMap<object, ToolRenderCacheEntry>();
let markdownRenderCache = new WeakMap<object, MarkdownRenderCacheEntry>();
let userRenderCache = new WeakMap<object, RenderCacheEntry>();

function invalidatePatchedRender(target: object): void {
  markdownRenderCache.delete(target);
  userRenderCache.delete(target);
}

export function restore(proto: PatchedPrototype): void {
  const originals = proto[ORIGINALS];
  if (!originals) return;
  for (const [key, value] of Object.entries(originals)) proto[key] = value;
  proto[PATCHED] = false;
  proto[ORIGINALS] = undefined;
  toolRenderCache = new WeakMap<object, ToolRenderCacheEntry>();
  markdownRenderCache = new WeakMap<object, MarkdownRenderCacheEntry>();
  userRenderCache = new WeakMap<object, RenderCacheEntry>();
}

export function installMarkdownPatch(
  proto: PatchedPrototype & Renderable,
  helpers: WidthHelpers,
): void {
  if (proto[PATCHED]) return;

  proto[ORIGINALS] = {
    render: proto.render,
    invalidate: proto.invalidate,
    setText: proto.setText,
  };

  const invalidate = function patchedMarkdownInvalidate(this: object): void {
    invalidatePatchedRender(this);
    const original = proto[ORIGINALS]?.invalidate as ((this: object) => void) | undefined;
    original?.call(this);
  };
  if (typeof proto.invalidate === "function") proto.invalidate = invalidate;

  const setText = function patchedMarkdownSetText(this: object, ...args: unknown[]): unknown {
    invalidatePatchedRender(this);
    const original = proto[ORIGINALS]?.setText as ((this: object, ...args: unknown[]) => unknown) | undefined;
    return original?.apply(this, args);
  };
  if (typeof proto.setText === "function") proto.setText = setText;

  proto.render = function patchedMarkdownRender(this: Renderable, width: number): string[] {
    const theme = getTheme();
    const controls = getInlineCodeControls(this);
    const cached = markdownRenderCache.get(this);
    if (cached && cached.width === width && cached.theme === theme && cached.controls === controls) {
      setInlineControlTargets(this, cached.targets);
      return cached.lines;
    }

    const original = proto[ORIGINALS]?.render as ((this: Renderable, width: number) => string[]) | undefined;
    const lines = original ? original.call(this, width) : [];
    const rendered = renderCodeBlocksWithControls(lines, width, theme, helpers, controls);
    markdownRenderCache.set(this, {
      width,
      theme,
      controls,
      lines: rendered.lines,
      targets: rendered.targets,
    });
    setInlineControlTargets(this, rendered.targets);
    return rendered.lines;
  };

  proto[PATCHED] = true;
}

    export function installToolMessagePatch(
      proto: PatchedPrototype & Renderable,
      helpers: WidthHelpers,
    ): void {
      if (proto[PATCHED]) return;

      proto[ORIGINALS] = {
        render: proto.render,
        invalidate: proto.invalidate,
        updateArgs: proto.updateArgs,
        updateResult: proto.updateResult,
        markExecutionStarted: proto.markExecutionStarted,
        setArgsComplete: proto.setArgsComplete,
        setExpanded: proto.setExpanded,
        setShowImages: proto.setShowImages,
        setImageWidthCells: proto.setImageWidthCells,
        updateDisplay: proto.updateDisplay,
      };

      const invalidateToolCache = (target: object): void => {
        toolRenderCache.delete(target);
      };

      const wrapInvalidatingMethod = (name: string): void => {
        const original = proto[ORIGINALS]?.[name];
        if (typeof original !== "function") return;
        proto[name] = function patchedToolMethod(this: object, ...args: unknown[]): unknown {
          invalidateToolCache(this);
          return (original as (this: object, ...args: unknown[]) => unknown).apply(this, args);
        };
      };

      for (const name of [
        "invalidate",
        "updateArgs",
        "updateResult",
        "markExecutionStarted",
        "setArgsComplete",
        "setExpanded",
        "setShowImages",
        "setImageWidthCells",
        "updateDisplay",
      ]) {
        wrapInvalidatingMethod(name);
      }

      proto.render = function patchedToolMessageRender(this: Renderable, width: number): string[] {
        const tool = this as ToolRenderTarget;
        const theme = getTheme();
        const isPartial = tool.isPartial === true;
        const isError = tool.result?.isError === true;
        const cached = toolRenderCache.get(this);
        if (
          cached &&
          cached.width === width &&
          cached.toolName === tool.toolName &&
          cached.isPartial === isPartial &&
          cached.isError === isError &&
          cached.theme === theme
        ) {
          return cached.lines;
        }

        const original = proto[ORIGINALS]?.render as ((this: Renderable, width: number) => string[]) | undefined;
        const lines = original ? original.call(this, width) : [];
        const rendered = renderToolMessage(
          tool.toolName,
          lines,
          width,
          theme,
          helpers,
          { isPartial, isError },
        );
        toolRenderCache.set(this, {
          width,
          toolName: tool.toolName,
          isPartial,
          isError,
          theme,
          lines: rendered,
        });
        return rendered;
      };

      proto[PATCHED] = true;
    }

export function installUserMessagePatch(
  proto: PatchedPrototype & Renderable,
  helpers: WidthHelpers,
): void {
  if (proto[PATCHED]) return;

  proto[ORIGINALS] = {
    render: proto.render,
    invalidate: proto.invalidate,
  };

  proto.invalidate = function patchedInvalidate(this: Renderable): void {
    invalidatePatchedRender(this);
    const original = proto[ORIGINALS]?.invalidate as ((this: Renderable) => void) | undefined;
    original?.call(this);
  };

  proto.render = function patchedRender(this: Renderable, width: number): string[] {
    const theme = getTheme();
    const cached = userRenderCache.get(this);
    if (cached && cached.width === width && cached.theme === theme) return cached.lines;

    const original = proto[ORIGINALS]?.render as ((this: Renderable, width: number) => string[]) | undefined;
    const contentWidth = Math.max(1, width - 4);
    const lines = original ? renderUserBox(original.call(this, contentWidth), width, theme, helpers) : [];
    userRenderCache.set(this, { width, theme, lines });
    return lines;
  };

  proto[PATCHED] = true;
}
