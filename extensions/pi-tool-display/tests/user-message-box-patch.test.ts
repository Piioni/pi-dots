import assert from "node:assert/strict";
import test from "node:test";

import {
  patchUserMessageRenderPrototype,
  unregisterUserMessageRenderPrototypePatch,
  type PatchableUserMessagePrototype,
} from "../src/user-message-box-patch.js";

function createPrototype(render: (width: number) => string[]): PatchableUserMessagePrototype {
  return { render };
}

test("cleanup preserves a later extension's replacement render", () => {
  const predecessor = (width: number): string[] => [`original:${width}`];
  const laterExtensionRender = (width: number): string[] => [`later:${width}`];
  const prototype = createPrototype(predecessor);

  patchUserMessageRenderPrototype(prototype, 1, (original) => (width) => ["wrapped", ...original(width)]);
  prototype.render = laterExtensionRender;
  unregisterUserMessageRenderPrototypePatch(prototype);

  assert.equal(prototype.render, laterExtensionRender);
  assert.deepEqual(prototype.render(80), ["later:80"]);
});

test("cleanup restores the saved predecessor while this patch still owns render", () => {
  const predecessor = (width: number): string[] => [`original:${width}`];
  const prototype = createPrototype(predecessor);

  patchUserMessageRenderPrototype(prototype, 1, (original) => (width) => ["wrapped", ...original(width)]);
  unregisterUserMessageRenderPrototypePatch(prototype);

  assert.equal(prototype.render, predecessor);
  assert.deepEqual(prototype.render(80), ["original:80"]);
});
