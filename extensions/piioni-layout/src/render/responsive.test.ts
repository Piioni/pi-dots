import assert from "node:assert/strict";
import test from "node:test";
import {
  selectResponsiveFooterPrimary,
  selectResponsiveFooterTokens,
  selectResponsiveHeader,
} from "./responsive.ts";

test("header keeps all parts when width allows", () => {
  const decision = selectResponsiveHeader({
    width: 48,
    cwd: "/workspace/project",
    branch: "branch",
    gitState: "MERGING",
    gitStatus: "+1 !2",
  });

  assert.equal(decision.branch, "branch");
  assert.equal(decision.gitState, "MERGING");
  assert.equal(decision.gitStatus, "+1 !2");
});

test("header drops git status before git state and branch", () => {
  const decision = selectResponsiveHeader({
    width: 30,
    cwd: "/workspace/project",
    branch: "branch",
    gitState: "MERGING",
    gitStatus: "+1 !2",
  });

  assert.equal(decision.branch, "branch");
  assert.equal(decision.gitState, "MERGING");
  assert.equal(decision.gitStatus, undefined);
});

test("header drops git state after git status when still constrained", () => {
  const decision = selectResponsiveHeader({
    width: 25,
    cwd: "/workspace/project",
    branch: "branch",
    gitState: "MERGING",
    gitStatus: "+1 !2",
  });

  assert.equal(decision.branch, "branch");
  assert.equal(decision.gitState, undefined);
  assert.equal(decision.gitStatus, undefined);
});

test("header collapses to cwd only when width is narrow", () => {
  const decision = selectResponsiveHeader({
    width: 12,
    cwd: "/workspace/project",
    branch: "branch",
    gitState: "MERGING",
    gitStatus: "+1 !2",
  });

  assert.equal(decision.branch, undefined);
  assert.equal(decision.gitState, undefined);
  assert.equal(decision.gitStatus, undefined);
});

test("footer primary keeps PR and context when both fit", () => {
  const decision = selectResponsiveFooterPrimary({
    width: 60,
    left: "mode • model • thinking",
    pullRequest: "PR #42",
    context: "Contexto: 43.2%/128k",
  });

  assert.equal(decision.includesPullRequest, true);
  assert.equal(decision.includesContext, true);
  assert.match(decision.right, /PR #42/);
  assert.match(decision.right, /Contexto:/);
});

test("footer primary drops PR before context", () => {
  const decision = selectResponsiveFooterPrimary({
    width: 47,
    left: "mode • model • thinking",
    pullRequest: "PR #42",
    context: "Contexto: 43.2%/128k",
  });

  assert.equal(decision.includesPullRequest, false);
  assert.equal(decision.includesContext, true);
  assert.equal(decision.right, "Contexto: 43.2%/128k");
});

test("footer primary collapses right side entirely when context does not fit", () => {
  const decision = selectResponsiveFooterPrimary({
    width: 30,
    left: "mode • model • thinking",
    pullRequest: "PR #42",
    context: "Contexto: 43.2%/128k",
  });

  assert.equal(decision.includesPullRequest, false);
  assert.equal(decision.includesContext, false);
  assert.equal(decision.right, "");
});

test("footer tokens keeps full tier when width allows", () => {
  const decision = selectResponsiveFooterTokens({
    width: 80,
    input: "↑12k",
    output: "↓3k",
    cache: "R4k",
    cacheHit: "CH90.0%",
    cost: "$0.123",
  });

  assert.equal(decision.tier, "full");
  assert.deepEqual(decision.parts, ["↑12k", "↓3k", "R4k", "CH90.0%", "$0.123"]);
});

test("footer tokens degrades to medium without cache read", () => {
  const decision = selectResponsiveFooterTokens({
    width: 34,
    input: "↑12k",
    output: "↓3k",
    cache: "R4k",
    cacheHit: "CH90.0%",
    cost: "$0.123",
  });

  assert.equal(decision.tier, "medium");
  assert.deepEqual(decision.parts, ["↑12k", "↓3k", "CH90.0%", "$0.123"]);
});

test("footer tokens degrades to small and tiny tiers by importance", () => {
  const small = selectResponsiveFooterTokens({
    width: 28,
    input: "↑12k",
    output: "↓3k",
    cache: "R4k",
    cacheHit: "CH90.0%",
    cost: "$0.123",
  });
  const tiny = selectResponsiveFooterTokens({
    width: 20,
    input: "↑12k",
    output: "↓3k",
    cache: "R4k",
    cacheHit: "CH90.0%",
    cost: "$0.123",
  });

  assert.equal(small.tier, "small");
  assert.deepEqual(small.parts, ["CH90.0%", "$0.123"]);
  assert.equal(tiny.tier, "tiny");
  assert.deepEqual(tiny.parts, ["$0.123"]);
});
