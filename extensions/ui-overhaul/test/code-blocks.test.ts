import assert from "node:assert/strict";
import test from "node:test";
import { extractAssistantCodeBlocks, scanFencedBlocks, setMarkedLexer } from "../src/code-blocks.ts";

const message = (content: Array<{ type: "text"; text: string }>) => ({ content });

test("extracts complete backtick and tilde fences with exact raw payloads", () => {
  const source = [
    "```` typescript example",
    "\tconst π = '\\x1b[31m';",
    "",
    "│ border-like text │",
    "`````",
    "~~~ bash extra words",
    "echo 'ok'",
    "~~~~",
  ].join("\n");

  assert.deepEqual(scanFencedBlocks(source), [
    {
      candidateIndex: 0,
      marker: "`",
      fenceLength: 4,
      info: "typescript example",
      code: "\tconst π = '\\x1b[31m';\n\n│ border-like text │",
      complete: true,
    },
    {
      candidateIndex: 1,
      marker: "~",
      fenceLength: 3,
      info: "bash extra words",
      code: "echo 'ok'",
      complete: true,
    },
  ]);
});

test("walks nested blockquotes and lists in source order across content parts", () => {
  const blocks = extractAssistantCodeBlocks(message([
    { type: "text", text: "> ```js\n> first()\n> ```\n\n- item\n  ~~~py\n  second()\n  ~~~" },
    { type: "text", text: "```\nthird\n```" },
  ]));

  assert.deepEqual(blocks.map(({ key, blockIndex, contentPartIndex, code, info }) => ({
    key,
    blockIndex,
    contentPartIndex,
    code,
    info,
  })), [
    { key: "0:0", blockIndex: 1, contentPartIndex: 0, code: "first()", info: "js" },
    { key: "0:1", blockIndex: 2, contentPartIndex: 0, code: "second()", info: "py" },
    { key: "1:0", blockIndex: 3, contentPartIndex: 1, code: "third", info: "" },
  ]);
});

test("keeps empty complete blocks but excludes indented and inline code", () => {
  const source = [
    "```",
    "```",
    "",
    "    ```js",
    "    excluded()",
    "    ```",
    "",
    "Use `inline()` instead.",
  ].join("\n");

  assert.deepEqual(extractAssistantCodeBlocks(message([{ type: "text", text: source }])).map((block) => block.code), [""]);
});

test("retains incomplete candidates but fails closed for short and mismatched closures", () => {
  for (const source of ["```js\nshort()\n``", "~~~\nmismatch()\n```"]) {
    assert.deepEqual(scanFencedBlocks(source), [
      { candidateIndex: 0, marker: source.startsWith("`") ? "`" : "~", fenceLength: 3, info: source.startsWith("`") ? "js" : "", complete: false },
    ]);
    assert.deepEqual(extractAssistantCodeBlocks(message([{ type: "text", text: source }])), []);
  }
});

test("only exposes blocks completed in the current streaming snapshot", () => {
  const partial = message([{ type: "text", text: "```ts\nconst current = true;" }]);
  const complete = message([{ type: "text", text: "```ts\nconst current = true;\n```" }]);
  const mixed = message([{ type: "text", text: "```\none\n```\n```\ntwo\n```\n```\npartial" }]);

  assert.deepEqual(extractAssistantCodeBlocks(partial), []);
  assert.deepEqual(extractAssistantCodeBlocks(complete).map((block) => block.code), ["const current = true;"]);
  assert.deepEqual(extractAssistantCodeBlocks(mixed).map((block) => block.code), ["one", "two"]);
});

test("does not confuse fence-like source lines with valid closures", () => {
  const source = "````\nconst literal = '```';\n``` not a closer\n````";
  assert.deepEqual(extractAssistantCodeBlocks(message([{ type: "text", text: source }])).map((block) => block.code), [
    "const literal = '```';\n``` not a closer",
  ]);
});

test("uses configured Marked token trees and fails closed when the lexer throws", () => {
  setMarkedLexer(() => [{
    type: "blockquote",
    raw: "> ```js\n> nested()\n> ```",
    tokens: [{ type: "code", raw: "```js\nnested()\n```", text: "nested()", lang: "js" }],
  }]);
  assert.deepEqual(scanFencedBlocks("ignored"), [{
    candidateIndex: 0,
    marker: "`",
    fenceLength: 3,
    info: "js",
    code: "nested()",
    complete: true,
  }]);

  setMarkedLexer(() => { throw new Error("lexer failure"); });
  assert.deepEqual(scanFencedBlocks("```\nuncertain\n```"), []);
  setMarkedLexer(undefined);
});
