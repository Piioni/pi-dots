import assert from "node:assert/strict";
import test from "node:test";
import {
  extractAssistantCodeBlocks,
  extractAssistantCodeBlocksForHost,
  scanFencedBlocks,
  setMarkedLexer,
} from "../src/code-blocks.ts";
import { lexWithInstalledMarked } from "./marked.ts";

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

test("uses installed Pi TUI Marked for nested list and quote fences", () => {
  setMarkedLexer(lexWithInstalledMarked);
  try {
    const blocks = extractAssistantCodeBlocks(message([
      { type: "text", text: "> - quoted item\n>   ```js\n>   quoted()\n>   ```\n\n- item\n  ~~~py\n  listed()\n  ~~~" },
      { type: "text", text: "```\r\ncrlf()\r\n```" },
    ]));
    assert.deepEqual(blocks.map(({ key, code, contentPartIndex }) => ({ key, code, contentPartIndex })), [
      { key: "0:0", code: "quoted()", contentPartIndex: 0 },
      { key: "0:1", code: "listed()", contentPartIndex: 0 },
      { key: "1:0", code: "crlf()", contentPartIndex: 1 },
    ]);
  } finally {
    setMarkedLexer(undefined);
  }
});

test("reuses unchanged parts and safe incomplete-fence appends for the same host", () => {
  let lexerCalls = 0;
  setMarkedLexer((source) => { lexerCalls += 1; return lexWithInstalledMarked(source); });
  try {
    const host = {};
    const initial: ReturnType<typeof message> = { content: [
      { type: "text", text: "```ts\nfirst()\n```" },
      { type: "text", text: "~~~js\nsecond()\n~~~" },
    ] };
    assert.deepEqual(extractAssistantCodeBlocksForHost(host, initial).map((block) => block.key), ["0:0", "1:0"]);
    assert.deepEqual(extractAssistantCodeBlocksForHost(host, {
      content: initial.content.map((part) => ({ ...part, metadata: "updated" })),
    }).map((block) => block.key), ["0:0", "1:0"]);
    assert.equal(lexerCalls, 2, "new part objects with unchanged text are reused despite metadata changes");

    const growing: ReturnType<typeof message> = { content: [{ type: "text", text: "```ts\nconst result =" }] };
    assert.deepEqual(extractAssistantCodeBlocksForHost(host, growing), []);
    assert.deepEqual(extractAssistantCodeBlocksForHost(host, { content: [{ type: "text", text: `${growing.content[0]!.text} 42` }] }), []);
    assert.equal(lexerCalls, 3, "plain appends inside an open top-level fence reuse its incomplete candidate");
    assert.deepEqual(extractAssistantCodeBlocksForHost(host, { content: [{ type: "text", text: "```ts\nconst result = 42\n```" }] }).map((block) => block.code), ["const result = 42"]);
    assert.equal(lexerCalls, 4, "a possible closing fence always triggers canonical Marked analysis");

    const streamingHost = {};
    const withClosedBlock = "```js\nfirst()\n```\n```ts\npartial";
    assert.deepEqual(extractAssistantCodeBlocksForHost(streamingHost, message([{ type: "text", text: withClosedBlock }])).map((block) => block.code), ["first()"]);
    assert.deepEqual(extractAssistantCodeBlocksForHost(streamingHost, message([{ type: "text", text: `${withClosedBlock} body` }])).map((block) => block.code), ["first()"]);
    assert.equal(lexerCalls, 5, "safe appends retain completed blocks without reparsing the full part");
  } finally {
    setMarkedLexer(undefined);
  }
});

test("re-lexes split fence closures at every streaming boundary with installed Marked", () => {
  setMarkedLexer(lexWithInstalledMarked);
  try {
    const cases: { name: string; before: string; after: string }[] = [];
    for (const marker of ["`", "~"] as const) {
      for (const openingLength of [3, 5]) {
        for (const closingLength of [openingLength, openingLength + 2]) {
          for (const eol of ["\n", "\r\n"]) {
            for (let split = 1; split < openingLength; split += 1) {
              cases.push({
                name: `${marker} fence ${openingLength}/${closingLength}, ${eol === "\n" ? "LF" : "CRLF"}, split ${split}`,
                before: `${marker.repeat(openingLength)}js${eol}x${eol}${marker.repeat(split)}`,
                after: marker.repeat(closingLength - split),
              });
            }
          }
        }
      }
    }

    for (const scenario of cases) {
      const host = {};
      assert.deepEqual(extractAssistantCodeBlocksForHost(host, message([{ type: "text", text: scenario.before }])), [], `${scenario.name}: incomplete closure`);
      assert.deepEqual(
        extractAssistantCodeBlocksForHost(host, message([{ type: "text", text: scenario.before + scenario.after }])).map((block) => block.code),
        ["x"],
        `${scenario.name}: completed closure must expose its payload`,
      );
    }

    for (const [marker, invalidatingSuffix] of [["`", "~"], ["~", "`"]] as const) {
      for (const eol of ["\n", "\r\n"]) {
        const host = {};
        const partialClosure = `${marker.repeat(3)}js${eol}x${eol}${marker.repeat(2)}`;
        assert.deepEqual(extractAssistantCodeBlocksForHost(host, message([{ type: "text", text: partialClosure }])), []);
        assert.deepEqual(extractAssistantCodeBlocksForHost(host, message([{ type: "text", text: `${partialClosure}${invalidatingSuffix}` }])).map((block) => block.code), [], "a mismatched suffix must not be mistaken for a valid closure");
      }
    }
  } finally {
    setMarkedLexer(undefined);
  }
});

test("re-lexes edits, truncations, changed closure lines, and replaced or failing lexers", () => {
  let calls = 0;
  setMarkedLexer((source) => { calls += 1; return lexWithInstalledMarked(source); });
  const host = {};
  try {
    const original = "```js\nvalue()\n```";
    assert.deepEqual(extractAssistantCodeBlocksForHost(host, message([{ type: "text", text: original }])).map((block) => block.code), ["value()"]);
    assert.deepEqual(extractAssistantCodeBlocksForHost(host, message([{ type: "text", text: "```js\nchanged()\n```" }])).map((block) => block.code), ["changed()"]);
    assert.deepEqual(extractAssistantCodeBlocksForHost(host, message([{ type: "text", text: "```js\nchanged()" }])), []);
    assert.deepEqual(extractAssistantCodeBlocksForHost(host, message([{ type: "text", text: `${original} suffix` }])), []);
    assert.equal(calls, 4);

    setMarkedLexer((source) => { calls += 1; return lexWithInstalledMarked(source); });
    assert.deepEqual(extractAssistantCodeBlocksForHost(host, message([{ type: "text", text: original }])).map((block) => block.code), ["value()"]);
    assert.equal(calls, 5, "replacing the configured lexer invalidates host caches");
    assert.deepEqual(extractAssistantCodeBlocksForHost(host, message([{ type: "text", text: original }]), 1).map((block) => block.code), ["value()"]);
    assert.equal(calls, 6, "a new runtime generation invalidates host caches");

    setMarkedLexer(() => { calls += 1; throw new Error("lexer failure"); });
    assert.deepEqual(extractAssistantCodeBlocksForHost(host, message([{ type: "text", text: original }])), []);
    assert.deepEqual(extractAssistantCodeBlocksForHost(host, message([{ type: "text", text: original }])), []);
    assert.equal(calls, 8, "failed lexer results are not cached");
  } finally {
    setMarkedLexer(undefined);
  }
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
