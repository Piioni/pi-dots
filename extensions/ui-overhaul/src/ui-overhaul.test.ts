import assert from "node:assert/strict";
import test from "node:test";
import { registerUiOverhaulLifecycle } from "./lifecycle.ts";
import { renderCodeBlocks } from "./markdown.ts";
import { installMarkdownPatch, installUserMessagePatch, restore } from "./prototype-patches.ts";
import { resetRenderCache, setCurrentContext, type PatchedPrototype } from "./state.ts";
import { themedBackground } from "./rendering.ts";
import type { Renderable, ThemeLike, WidthHelpers } from "./types.ts";
import { renderUserBox } from "./user-message.ts";

const ansiPattern = /\x1b\[[0-9;]*m/g;
const plainTheme: ThemeLike = {
  bg: (_color, text) => text,
  fg: (_color, text) => text,
  bold: (text) => text,
  getBgAnsi: () => "",
};

const widthHelpers: WidthHelpers = {
  visibleWidth(line) {
    return Array.from(line.replace(ansiPattern, "")).reduce(
      (width, character) => width + (character === "👤" ? 2 : 1),
      0,
    );
  },
  truncateToWidth(line, width, _ellipsis, pad) {
    if (this.visibleWidth(line) <= width) {
      return pad ? line + " ".repeat(width - this.visibleWidth(line)) : line;
    }

    let rendered = "";
    let used = 0;
    for (const character of Array.from(line)) {
      const characterWidth = character === "👤" ? 2 : 1;
      if (used + characterWidth > width) break;
      rendered += character;
      used += characterWidth;
    }
    return pad ? rendered + " ".repeat(width - used) : rendered;
  },
};

test("preserves the baseline user and code box output", () => {
  const user = renderUserBox(
    ["alpha", "", "────────", "\x1b]133;A\x07beta"],
    18,
    plainTheme,
    widthHelpers,
  );
  const markdown = renderCodeBlocks(
    ["before", "```ts", "  const x = 1;  ", "```", "after"],
    18,
    plainTheme,
    widthHelpers,
  );

  assert.deepEqual(user, [
    "",
    "╭ 👤 user ───────╮",
    "│ alpha          │",
    "│ beta           │",
    "╰────────────────╯",
  ]);
  assert.deepEqual(markdown, [
    "before",
    "╭  ts ──────────╮",
    "│   const x = 1; │",
    "╰────────────────╯",
    "after",
  ]);
});

test("renders canonical language icons, aliases, and an unknown-language fallback", () => {
  const cases = [
    { lines: ["```TypeScript", "x", "```"], width: 18, top: "╭  TypeScript ──╮" },
    { lines: ["```ts", "x", "```"], width: 18, top: "╭  ts ──────────╮" },
    { lines: ["```tsx", "x", "```"], width: 18, top: "╭  tsx ─────────╮" },
    { lines: ["```node", "x", "```"], width: 18, top: "╭  node ────────╮" },
    { lines: ["```brainfuck", "x", "```"], width: 18, top: "╭  brainfuck ───╮" },
  ];

  for (const { lines, width, top } of cases) {
    const rendered = renderCodeBlocks(lines, width, plainTheme, widthHelpers);
    assert.equal(rendered[0], top);
    assert.equal(widthHelpers.visibleWidth(rendered[0]!), width);
  }
});

test("renders dedicated plain-text headers for every alias", () => {
  const cases = [
    { language: "text", top: "╭ 󰈙 text ────────╮" },
    { language: "txt", top: "╭ 󰈙 txt ─────────╮" },
    { language: "plaintext", top: "╭ 󰈙 plaintext ───╮" },
    { language: "plain", top: "╭ 󰈙 plain ───────╮" },
  ];

  for (const { language, top } of cases) {
    const rendered = renderCodeBlocks([`\`\`\`${language}`, "x", "\`\`\`"], 18, plainTheme, widthHelpers);
    assert.equal(rendered[0], top);
    assert.equal(widthHelpers.visibleWidth(rendered[0]!), 18);
    assert.ok(rendered[0]!.endsWith("╮"));
  }
});

test("preserves dedicated Bash headers for every alias", () => {
  const cases = [
    { language: "bash", top: "╭  bash ────────╮" },
    { language: "shell", top: "╭  shell ───────╮" },
    { language: "sh", top: "╭  sh ──────────╮" },
    { language: "zsh", top: "╭  zsh ─────────╮" },
    { language: "fish", top: "╭  fish ────────╮" },
  ];

  for (const { language, top } of cases) {
    const rendered = renderCodeBlocks([`\`\`\`${language}`, "x", "\`\`\`"], 18, plainTheme, widthHelpers);
    assert.equal(rendered[0], top);
    assert.equal(widthHelpers.visibleWidth(rendered[0]!), 18);
    assert.ok(rendered[0]!.endsWith("╮"));
  }
});

test("keeps unlabeled fences free of icons and labels", () => {
  const rendered = renderCodeBlocks(["```", "x", "```"], 18, plainTheme, widthHelpers);
  assert.equal(rendered[0], "╭────────────────╮");
  assert.equal(widthHelpers.visibleWidth(rendered[0]!), 18);
});

test("preserves trailing non-fence lines after a code box", () => {
  assert.deepEqual(
    renderCodeBlocks(["```ts", "x", "```", "", "  "], 10, plainTheme, widthHelpers),
    ["╭  ts ──╮", "│ x      │", "╰────────╯", "", "  "],
  );
});

test("keeps narrow-width and fence edge-case behavior", () => {
  const original = ["narrow"];
  assert.strictEqual(renderUserBox(original, 3, plainTheme, widthHelpers), original);
  assert.deepEqual(renderCodeBlocks(["```ts", "x", "```"], 2, plainTheme, widthHelpers), [
    "╭──╮",
    "│  │",
    "╰──╯",
  ]);
  assert.deepEqual(renderCodeBlocks(["```"], 10, plainTheme, widthHelpers), [
    "╭────────╮",
    "│        │",
    "╰────────╯",
  ]);
  assert.deepEqual(
    renderCodeBlocks(["```ts", "a", "```", "middle", "```js", "b"], 10, plainTheme, widthHelpers),
    [
      "╭  ts ──╮",
      "│ a      │",
      "╰────────╯",
      "middle",
      "╭  js ──╮",
      "│ b      │",
      "╰────────╯",
    ],
  );
});

test("truncates long code-block labels without consuming the border closure", () => {
  const rendered = renderCodeBlocks(
    ["```typescript-with-an-unusually-long-label", "x", "```"],
    12,
    plainTheme,
    widthHelpers,
  );

  assert.equal(rendered[0], "╭  types──╮");
  assert.equal(widthHelpers.visibleWidth(rendered[0]!), 12);
  assert.ok(rendered[0]!.endsWith("──╮"));
});

test("keeps every rendered code-box row at the supplied width", () => {
  for (const width of Array.from({ length: 37 }, (_, index) => index + 4)) {
    for (const lines of [
      ["```typescript", "const answer = 42;", "```"],
      ["```unknown-language", "const answer = 42;", "```"],
      ["```", "const answer = 42;", "```"],
    ]) {
      const rendered = renderCodeBlocks(lines, width, plainTheme, widthHelpers);
      for (const line of rendered) {
assert.equal(widthHelpers.visibleWidth(line), width, `width ${width}: ${line}`);
      }
    }
  }
});

test("preserves non-background ANSI while replacing background coverage", () => {
  const theme: ThemeLike = {
    bg: (_color, text) => `\x1b[48;5;12m${text}\x1b[49m`,
    fg: (_color, text) => text,
  };

  assert.equal(
    themedBackground("\x1b[48;5;4m\x1b[31mred\x1b[0m", 6, "toolPendingBg", theme, widthHelpers),
    "\x1b[48;5;12m\x1b[31m\x1b[48;5;12mred\x1b[0m\x1b[48;5;12m   \x1b[49m",
  );
});

test("caches by width, invalidates, restores, and reinstalls prototype patches", () => {
  let userRenderCalls = 0;
  let userInvalidateCalls = 0;
  let markdownRenderCalls = 0;
  const originalUserRender = function (): string[] {
    userRenderCalls += 1;
    return ["content"];
  };
  const originalUserInvalidate = function (): void {
    userInvalidateCalls += 1;
  };
  const originalMarkdownRender = function (): string[] {
    markdownRenderCalls += 1;
    return ["```ts", "x", "```"];
  };
  const userPrototype = {
    render: originalUserRender,
    invalidate: originalUserInvalidate,
  } as unknown as PatchedPrototype & Renderable & { invalidate(this: object): void };
  const markdownPrototype = {
    render: originalMarkdownRender,
  } as unknown as PatchedPrototype & Renderable;
  const component = {} as Renderable & object;

  setCurrentContext({ ui: { theme: plainTheme } } as never);
  try {
    installUserMessagePatch(userPrototype, widthHelpers);
    installUserMessagePatch(userPrototype, widthHelpers);
    installMarkdownPatch(markdownPrototype, widthHelpers);
    installMarkdownPatch(markdownPrototype, widthHelpers);

    const first = userPrototype.render.call(component, 18);
    assert.strictEqual(userPrototype.render.call(component, 18), first);
    assert.equal(userRenderCalls, 1);
    userPrototype.render.call(component, 20);
    assert.equal(userRenderCalls, 2);
    userPrototype.render.call(component, 18);
    assert.equal(userRenderCalls, 3);

    userPrototype.invalidate.call(component);
    assert.equal(userInvalidateCalls, 1);
    userPrototype.render.call(component, 18);
    assert.equal(userRenderCalls, 4);

    assert.deepEqual(markdownPrototype.render.call({}, 18), [
      "╭  ts ──────────╮",
      "│ x              │",
      "╰────────────────╯",
    ]);
    assert.equal(markdownRenderCalls, 1);

    restore(userPrototype);
    restore(markdownPrototype);
    assert.strictEqual(userPrototype.render, originalUserRender);
    assert.strictEqual(userPrototype.invalidate, originalUserInvalidate);
    assert.strictEqual(markdownPrototype.render, originalMarkdownRender);

    installUserMessagePatch(userPrototype, widthHelpers);
    installMarkdownPatch(markdownPrototype, widthHelpers);
    assert.notStrictEqual(userPrototype.render, originalUserRender);
    assert.notStrictEqual(markdownPrototype.render, originalMarkdownRender);
    restore(userPrototype);
    restore(markdownPrototype);
  } finally {
    resetRenderCache();
    setCurrentContext(undefined);
  }
});

test("registers TUI-only lifecycle behavior and restores patches across restart", async () => {
  const originalUserRender = function (): string[] {
    return ["content"];
  };
  const originalUserInvalidate = function (): void {};
  const originalMarkdownRender = function (): string[] {
    return ["markdown"];
  };
  const userPrototype = {
    render: originalUserRender,
    invalidate: originalUserInvalidate,
  } as unknown as PatchedPrototype & Renderable;
  const markdownPrototype = {
    render: originalMarkdownRender,
  } as unknown as PatchedPrototype & Renderable;
  const handlers = new Map<string, (event: unknown, context?: unknown) => Promise<void>>();
  const pi = {
    on(name: string, handler: (event: unknown, context?: unknown) => Promise<void>) {
      handlers.set(name, handler);
    },
  };

  registerUiOverhaulLifecycle(pi as never, userPrototype, markdownPrototype, widthHelpers);
  const start = handlers.get("session_start");
  const shutdown = handlers.get("session_shutdown");
  assert.ok(start);
  assert.ok(shutdown);

  await start({}, { hasUI: false, mode: "tui" });
  await start({}, { hasUI: true, mode: "print" });
  assert.strictEqual(userPrototype.render, originalUserRender);
  assert.strictEqual(markdownPrototype.render, originalMarkdownRender);

  const tuiContext = { hasUI: true, mode: "tui", ui: { theme: plainTheme } };
  await start({}, tuiContext);
  assert.notStrictEqual(userPrototype.render, originalUserRender);
  assert.notStrictEqual(markdownPrototype.render, originalMarkdownRender);

  await shutdown({});
  assert.strictEqual(userPrototype.render, originalUserRender);
  assert.strictEqual(markdownPrototype.render, originalMarkdownRender);

  await start({}, tuiContext);
  assert.notStrictEqual(userPrototype.render, originalUserRender);
  await shutdown({});
  assert.strictEqual(userPrototype.render, originalUserRender);
  assert.strictEqual(markdownPrototype.render, originalMarkdownRender);
});
