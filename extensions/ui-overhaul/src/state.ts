import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { AssistantSourceRegistry } from "./code-copy.ts";
import type { RenderCacheEntry, ThemeLike } from "./types.ts";

export const PATCHED = Symbol.for("me.pi.ui-overhaul.patched");
export const ORIGINALS = Symbol.for("me.pi.ui-overhaul.originals");

export type PatchedPrototype = Record<PropertyKey, unknown> & {
  [PATCHED]?: boolean;
  [ORIGINALS]?: Record<string, unknown>;
};

let currentCtx: ExtensionContext | undefined;
let renderCache = new WeakMap<object, RenderCacheEntry>();
let runtimeGeneration = 0;
export const assistantSourceRegistry = new AssistantSourceRegistry();

export function setCurrentContext(ctx: ExtensionContext | undefined): void {
  currentCtx = ctx;
}

export function getTheme(): ThemeLike | undefined {
  return currentCtx?.ui.theme as ThemeLike | undefined;
}

export function getCurrentContext(): ExtensionContext | undefined {
  return currentCtx;
}

export function getRenderCache(target: object): RenderCacheEntry | undefined {
  return renderCache.get(target);
}

export function setRenderCache(target: object, entry: RenderCacheEntry): void {
  renderCache.set(target, entry);
}

export function invalidateRenderCache(target: object): void {
  renderCache.delete(target);
}

export function resetRenderCache(): void {
  renderCache = new WeakMap<object, RenderCacheEntry>();
}

export function getRuntimeGeneration(): number {
  return runtimeGeneration;
}

export function resetCodeCopyState(): void {
  runtimeGeneration += 1;
  assistantSourceRegistry.clear();
}
