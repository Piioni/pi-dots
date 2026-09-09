import assert from "node:assert/strict";
import test from "node:test";
import { buildDashboardExtensionsSnapshot } from "./footer.ts";

function snapshot(statuses: Record<string, string>) {
  return buildDashboardExtensionsSnapshot({
    getExtensionStatuses: () => new Map(Object.entries(statuses)),
  });
}

test("preserves legacy MCP, MCP auth, and LSP status parsing", () => {
  assert.deepEqual(
    snapshot({
      mcp: "MCP: 1/2 servers",
      "mcp-auth": "MCP authenticating",
      "pi-lens-lsp": "LSP Active: typescript · LSP Failed: python",
    }).parts,
    [
      { text: "MCP 1/2", tone: "accent" },
      { text: "MCP auth", tone: "accent" },
      { text: "LSP ts", tone: "success" },
      { text: "failed: py", tone: "error" },
    ],
  );
});

test("renders decoded MCP health states compactly", () => {
  const cases = [
    ["healthy", '{"state":"healthy","connected":2,"total":2}', { text: "MCP 2/2", tone: "success" }],
    ["partial", '{"state":"partial","connected":1,"total":2}', { text: "MCP 1/2", tone: "accent" }],
    ["failed", '{"state":"failed","connected":0,"total":2}', { text: "MCP 0/2", tone: "error" }],
    ["off", '{"state":"off","connected":0,"total":0}', { text: "MCP off", tone: "dim" }],
  ] as const;

  for (const [state, value, expected] of cases) {
    assert.deepEqual(snapshot({ mcp: value }).parts, [expected], state);
  }
});

test("renders decoded LSP health states compactly", () => {
  const cases = [
    ["healthy", '{"state":"healthy","active":["typescript"],"failed":[]}', [{ text: "LSP ts", tone: "success" }]],
    [
      "partial",
      '{"state":"partial","active":["typescript"],"failed":["python"]}',
      [
        { text: "LSP ts", tone: "success" },
        { text: "failed: py", tone: "error" },
      ],
    ],
    ["failed", '{"state":"failed","active":[],"failed":["python"]}', [{ text: "LSP failed: py", tone: "error" }]],
    ["off", '{"state":"off","active":[],"failed":[]}', [{ text: "LSP inactive", tone: "dim" }]],
  ] as const;

  for (const [state, value, expected] of cases) {
    assert.deepEqual(snapshot({ "pi-lens-lsp": value }).parts, expected, state);
  }
});

test("falls back safely for malformed or incomplete JSON statuses", () => {
  assert.deepEqual(
    snapshot({
      mcp: '{"state":"healthy","connected":2}',
      "pi-lens-lsp": '{"state":"healthy","active":"typescript","failed":[]}',
    }).parts,
    [
      { text: '{"state":"healthy","connected":2}', tone: "dim" },
      { text: '{"state":"healthy","active":"typescript","failed":[]}', tone: "dim" },
    ],
  );

  assert.deepEqual(
    snapshot({ mcp: "{not-json", "pi-lens-lsp": "{not-json" }).parts,
    [
      { text: "{not-json", tone: "dim" },
      { text: "{not-json", tone: "dim" },
    ],
  );
});
