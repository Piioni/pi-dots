import assert from "node:assert/strict";
import test from "node:test";
import { createWorkspaceRefreshScheduler } from "./workspace-refresh.ts";

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

test("coalesces a burst of workspace refresh requests", async () => {
  const calls: string[] = [];
  const scheduler = createWorkspaceRefreshScheduler(async (cwd) => {
    calls.push(cwd);
  }, 1);

  await Promise.all([
    scheduler.request("/workspace/project"),
    scheduler.request("/workspace/project"),
    scheduler.request("/workspace/project"),
  ]);

  assert.deepEqual(calls, ["/workspace/project"]);
  scheduler.shutdown();
});

test("runs the newest workspace refresh after an active lookup settles", async () => {
  const calls: string[] = [];
  let releaseFirst: (() => void) | undefined;
  const firstLookup = new Promise<void>((resolve) => {
    releaseFirst = resolve;
  });
  const scheduler = createWorkspaceRefreshScheduler(async (cwd) => {
    calls.push(cwd);
    if (cwd === "/workspace/first") await firstLookup;
  }, 1);

  const first = scheduler.request("/workspace/first");
  await delay(5);
  const second = scheduler.request("/workspace/second");

  assert.equal(scheduler.hasNewerRequest(), true);
  assert.deepEqual(calls, ["/workspace/first"]);

  releaseFirst?.();
  await Promise.all([first, second]);

  assert.deepEqual(calls, ["/workspace/first", "/workspace/second"]);
  assert.equal(scheduler.hasNewerRequest(), false);
  scheduler.shutdown();
});
