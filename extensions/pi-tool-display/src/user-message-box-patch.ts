export type UserMessageRenderFn = (width: number) => string[];

const USER_MESSAGE_PATCH_OWNER = Symbol.for("me.pi.pi-tool-display.user-message-render-owner");
const USER_MESSAGE_RENDER_LAYER = Symbol.for("me.pi.user-message-render-layer");

type UserMessageRenderLayer = { owner: symbol | string; original: UserMessageRenderFn; active: boolean };
type LayeredUserMessageRender = UserMessageRenderFn & { [USER_MESSAGE_RENDER_LAYER]?: UserMessageRenderLayer };

function getRenderLayer(render: UserMessageRenderFn): UserMessageRenderLayer | undefined {
  return (render as LayeredUserMessageRender)[USER_MESSAGE_RENDER_LAYER];
}

function deactivateRenderOwner(render: UserMessageRenderFn, owner: symbol | string): void {
  let current: UserMessageRenderFn | undefined = render;
  while (current) {
    const layer = getRenderLayer(current);
    if (!layer) return;
    if (layer.owner === owner) layer.active = false;
    current = layer.original;
  }
}

function unwrapInactiveRenders(render: UserMessageRenderFn): UserMessageRenderFn {
  let current = render;
  while (true) {
    const layer = getRenderLayer(current);
    if (!layer || layer.active) return current;
    current = layer.original;
  }
}

function containsRender(render: UserMessageRenderFn, target: UserMessageRenderFn): boolean {
  let current: UserMessageRenderFn | undefined = render;
  while (current) {
    if (current === target) return true;
    current = getRenderLayer(current)?.original;
  }
  return false;
}

function clearPatchMetadata(prototype: PatchableUserMessagePrototype): void {
  delete prototype.__piUserMessageOriginalRender;
  delete prototype.__piUserMessagePatchedRender;
  delete prototype.__piUserMessageNativePatched;
  delete prototype.__piUserMessagePatchVersion;
  delete prototype.__piUserMessagePatchOwner;
}

export interface PatchableUserMessagePrototype {
  render: UserMessageRenderFn;
  __piUserMessageOriginalRender?: UserMessageRenderFn;
  __piUserMessagePatchedRender?: UserMessageRenderFn;
  __piUserMessageNativePatched?: boolean;
  __piUserMessagePatchVersion?: number;
  __piUserMessagePatchOwner?: symbol | object;
}

export function unregisterUserMessageRenderPrototypePatch(
  prototype: PatchableUserMessagePrototype,
): void {
  const patchedRender = prototype.__piUserMessagePatchedRender;
  if (!patchedRender || prototype.__piUserMessagePatchOwner !== USER_MESSAGE_PATCH_OWNER) return;

  deactivateRenderOwner(prototype.render, USER_MESSAGE_PATCH_OWNER);
  const layer = getRenderLayer(patchedRender);
  if (layer) layer.active = false;
  if (prototype.render === patchedRender) prototype.render = unwrapInactiveRenders(patchedRender);
  prototype.__piUserMessageNativePatched = false;
  if (!containsRender(prototype.render, patchedRender)) clearPatchMetadata(prototype);
}

export function patchUserMessageRenderPrototype(
  prototype: PatchableUserMessagePrototype,
  patchVersion: number,
  buildRender: (originalRender: UserMessageRenderFn) => UserMessageRenderFn,
): void {
  if (typeof prototype.render !== "function") return;

  const previousPatch = prototype.__piUserMessagePatchedRender;
  if (previousPatch && prototype.__piUserMessagePatchOwner === USER_MESSAGE_PATCH_OWNER) {
    if (prototype.__piUserMessageNativePatched && prototype.__piUserMessagePatchVersion === patchVersion
      && containsRender(prototype.render, previousPatch)) return;
    deactivateRenderOwner(prototype.render, USER_MESSAGE_PATCH_OWNER);
    const previousLayer = getRenderLayer(previousPatch);
    if (previousLayer) previousLayer.active = false;
    if (prototype.render === previousPatch) prototype.render = unwrapInactiveRenders(previousPatch);
    if (containsRender(prototype.render, previousPatch)) {
      prototype.__piUserMessageNativePatched = false;
      return;
    }
    clearPatchMetadata(prototype);
  } else if (prototype.__piUserMessagePatchedRender) {
    const previousOriginal = prototype.__piUserMessageOriginalRender;
    if (prototype.render === prototype.__piUserMessagePatchedRender && previousOriginal) {
      prototype.render = previousOriginal;
    }
    clearPatchMetadata(prototype);
  }

  const originalRender = unwrapInactiveRenders(prototype.render);
  prototype.render = originalRender;
  const styledRender = buildRender(originalRender);
  const layer: UserMessageRenderLayer = {
    owner: USER_MESSAGE_PATCH_OWNER,
    original: originalRender,
    active: true,
  };
  const patchedRender: LayeredUserMessageRender = function (this: unknown, ...args: Parameters<UserMessageRenderFn>): string[] {
    return (layer.active ? styledRender : originalRender).apply(this, args);
  };
  patchedRender[USER_MESSAGE_RENDER_LAYER] = layer;
  prototype.render = patchedRender;
  prototype.__piUserMessageOriginalRender = originalRender;
  prototype.__piUserMessagePatchedRender = patchedRender;
  prototype.__piUserMessageNativePatched = true;
  prototype.__piUserMessagePatchVersion = patchVersion;
  prototype.__piUserMessagePatchOwner = USER_MESSAGE_PATCH_OWNER;
}
