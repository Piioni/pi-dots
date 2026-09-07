import assert from "node:assert/strict";
import test from "node:test";

const { isProjectTrusted } = await import(new URL("./project.ts", import.meta.url).href);

test("treats a project as untrusted when Pi does not report trusted state", () => {
  assert.equal(isProjectTrusted({ isProjectTrusted: () => false }), false);
  assert.equal(isProjectTrusted({ isProjectTrusted: () => true }), true);
  assert.equal(
    isProjectTrusted({
      isProjectTrusted: () => {
        throw new Error("trust state unavailable");
      },
    }),
    false,
  );
});
