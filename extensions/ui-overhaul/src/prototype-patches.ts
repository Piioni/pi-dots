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
const USER_MESSAGE_RENDER_LAYER = Symbol.for("me.pi.user-message-render-layer");
const UI_OVERHAUL_RENDER_OWNER = "ui-overhaul";

type UserMessageRender = Renderable["render"] & { [USER_MESSAGE_RENDER_LAYER]?: UserMessageRenderLayer };
type UserMessageRenderLayer = { owner: string; original: UserMessageRender; active: boolean };

function getUserMessageRenderLayer(render: Renderable["render"]): UserMessageRenderLayer | undefined {
  return (render as UserMessageRender)[USER_MESSAGE_RENDER_LAYER];
}

function deactivateUserMessageRender(render: UserMessageRender, owner: string): void {
  let current: UserMessageRender | undefined = render;
  while (current) {
    const layer = getUserMessageRenderLayer(current);
    if (!layer) return;
    if (layer.owner === owner) layer.active = false;
    current = layer.original;
  }
}

function unwrapInactiveUserMessageRenders(render: UserMessageRender): UserMessageRender {
  let current = render;
  while (true) {
    const layer = getUserMessageRenderLayer(current);
    if (!layer || layer.active) return current;
    current = layer.original;
  }
}

function invalidatePatchedRender(target: object): void {
  markdownRenderCache.delete(target);
  userRenderCache.delete(target);
}

export function restore(proto: PatchedPrototype): void {
  const originals = proto[ORIGINALS];
  if (!originals) return;
  const userMessagePatch = originals.__uiUserMessagePatchedRender as UserMessageRender | undefined;
  if (userMessagePatch) {
    const layer = getUserMessageRenderLayer(userMessagePatch);
    if (layer?.owner === UI_OVERHAUL_RENDER_OWNER) layer.active = false;
    const renderable = proto as PatchedPrototype & Renderable;
    if (renderable.render === userMessagePatch) {
      renderable.render = layer
        ? unwrapInactiveUserMessageRenders(userMessagePatch)
        : originals.render as Renderable["render"];
    }
  }
  for (const [key, value] of Object.entries(originals)) {
    if (key === "__uiUserMessagePatchedRender" || (key === "render" && userMessagePatch)) continue;
    proto[key] = value;
  }
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

  deactivateUserMessageRender(proto.render, UI_OVERHAUL_RENDER_OWNER);
  const originalRender = unwrapInactiveUserMessageRenders(proto.render);
  proto[ORIGINALS] = {
    render: originalRender,
    invalidate: proto.invalidate,
  };

  proto.invalidate = function patchedInvalidate(this: Renderable): void {
    invalidatePatchedRender(this);
    const original = proto[ORIGINALS]?.invalidate as ((this: Renderable) => void) | undefined;
    original?.call(this);
  };

  const layer: UserMessageRenderLayer = { owner: UI_OVERHAUL_RENDER_OWNER, original: originalRender, active: true };
  const patchedRender: Renderable["render"] = function patchedRender(this: Renderable, width: number): string[] {
    if (!layer.active) return originalRender.call(this, width);
    const theme = getTheme();
    const cached = userRenderCache.get(this);
    if (cached && cached.width === width && cached.theme === theme) return cached.lines;

    const contentWidth = Math.max(1, width - 4);
    const lines = renderUserBox(originalRender.call(this, contentWidth), width, theme, helpers);
    userRenderCache.set(this, { width, theme, lines });
    return lines;
  };
  (patchedRender as UserMessageRender)[USER_MESSAGE_RENDER_LAYER] = layer;
  proto.render = patchedRender;
  (proto[ORIGINALS] as Record<string, unknown>).__uiUserMessagePatchedRender = patchedRender;

  proto[PATCHED] = true;
}
