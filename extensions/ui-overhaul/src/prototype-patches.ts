import { renderCodeBlocks } from "./markdown.ts";
import {
  getRenderCache,
  getTheme,
  invalidateRenderCache,
  ORIGINALS,
  PATCHED,
  setRenderCache,
  type PatchedPrototype,
} from "./state.ts";
import { renderUserBox } from "./user-message.ts";
import type { Renderable, WidthHelpers } from "./types.ts";

export function restore(proto: PatchedPrototype): void {
  const originals = proto[ORIGINALS];
  if (!originals) return;
  for (const [key, value] of Object.entries(originals)) proto[key] = value;
  proto[PATCHED] = false;
  proto[ORIGINALS] = undefined;
}

export function installMarkdownPatch(
  proto: PatchedPrototype & Renderable,
  helpers: WidthHelpers,
): void {
  if (proto[PATCHED]) return;

  proto[ORIGINALS] = { render: proto.render };
  proto.render = function patchedMarkdownRender(this: Renderable, width: number): string[] {
    const original = proto[ORIGINALS]?.render as ((this: Renderable, width: number) => string[]) | undefined;
    const lines = original ? original.call(this, width) : [];
    return renderCodeBlocks(lines, width, getTheme(), helpers);
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

  proto.invalidate = function patchedInvalidate(this: object): void {
    invalidateRenderCache(this);
    const original = proto[ORIGINALS]?.invalidate as ((this: object) => void) | undefined;
    original?.call(this);
  };

  proto.render = function patchedRender(this: Renderable & object, width: number): string[] {
    const cached = getRenderCache(this);
    if (cached?.width === width) return cached.lines;

    const original = proto[ORIGINALS]?.render as ((this: Renderable, width: number) => string[]) | undefined;
    const contentWidth = Math.max(1, width - 4);
    const lines = original ? renderUserBox(original.call(this, contentWidth), width, getTheme(), helpers) : [];
    setRenderCache(this, { width, lines });
    return lines;
  };

  proto[PATCHED] = true;
}
