import assert from "node:assert/strict";
import test from "node:test";
import {
  selectResponsiveFooterPrimary,
  selectResponsiveFooterTokens,
  selectResponsiveHeader,
} from "./responsive.ts";

test("header keeps branch and git state when width allows", () => {
  const decision = selectResponsiveHeader({
    width: 48,
    cwd: "/workspace/project",
    branch: "branch",
    gitState: "MERGING",
  });

  assert.equal(decision.branch, "branch");
  assert.equal(decision.gitState, "MERGING");
});

test("header drops git state when constrained", () => {
  const decision = selectResponsiveHeader({
    width: 25,
    cwd: "/workspace/project",
    branch: "branch",
    gitState: "MERGING",
  });

  assert.equal(decision.branch, "branch");
  assert.equal(decision.gitState, undefined);
});

test("header collapses to cwd only when width is narrow", () => {
  const decision = selectResponsiveHeader({
    width: 12,
    cwd: "/workspace/project",
    branch: "branch",
    gitState: "MERGING",
  });

  assert.equal(decision.branch, undefined);
  assert.equal(decision.gitState, undefined);
});

test("footer primary keeps PR and context when both fit", () => {
  const decision = selectResponsiveFooterPrimary({
    width: 60,
    left: "mode • model • thinking",
    pullRequest: "PR #42",
    context: "ctx [====......] 43%",
  });

  assert.equal(decision.includesPullRequest, true);
  assert.equal(decision.includesContext, true);
  assert.match(decision.right, /PR #42/);
  assert.match(decision.right, /ctx \[/);
});

test("footer primary drops PR before context", () => {
  const decision = selectResponsiveFooterPrimary({
    width: 47,
    left: "mode • model • thinking",
    pullRequest: "PR #42",
    context: "ctx [====......] 43%",
  });

  assert.equal(decision.includesPullRequest, false);
  assert.equal(decision.includesContext, true);
  assert.equal(decision.right, "ctx [====......] 43%");
});

test("footer primary collapses right side entirely when context does not fit", () => {
  const decision = selectResponsiveFooterPrimary({
    width: 30,
    left: "mode • model • thinking",
    pullRequest: "PR #42",
    context: "ctx [====......] 43%",
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
  });

  assert.equal(decision.tier, "full");
  assert.deepEqual(decision.parts, ["↑12k", "↓3k", "R4k", "CH90.0%"]);
});

test("footer tokens degrades to medium without cache read", () => {
  const decision = selectResponsiveFooterTokens({
    width: 25,
    input: "↑12k",
    output: "↓3k",
    cache: "R4k",
    cacheHit: "CH90.0%",
  });

  assert.equal(decision.tier, "medium");
  assert.deepEqual(decision.parts, ["↑12k", "↓3k", "CH90.0%"]);
});

test("footer tokens degrades to the cache-hit tier when narrow", () => {
  const small = selectResponsiveFooterTokens({
    width: 20,
    input: "↑12k",
    output: "↓3k",
    cache: "R4k",
    cacheHit: "CH90.0%",
  });
  const narrow = selectResponsiveFooterTokens({
    width: 16,
    input: "↑12k",
    output: "↓3k",
    cache: "R4k",
    cacheHit: "CH90.0%",
  });

  assert.equal(small.tier, "small");
  assert.deepEqual(small.parts, ["CH90.0%"]);
  assert.equal(narrow.tier, "small");
  assert.deepEqual(narrow.parts, ["CH90.0%"]);
});
