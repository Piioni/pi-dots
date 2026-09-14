import assert from "node:assert/strict";
import test from "node:test";
import { registerUiOverhaulLifecycle } from "./lifecycle.ts";
import { restore } from "./prototype-patches.ts";
import { setCurrentContext, type PatchedPrototype } from "./state.ts";
import { renderToolMessage } from "./tool-message.ts";
import type { Renderable, ThemeLike, WidthHelpers } from "./types.ts";

const ansiPattern = /\x1b\[[0-9;]*m/g;
const normalBackground = "\x1b[48;5;240m";
const addedBackground = "\x1b[48;5;22m";
const removedBackground = "\x1b[48;5;52m";
const diffAddedBackground = "\x1b[48;5;34m";
const diffRemovedBackground = "\x1b[48;5;196m";

const theme: ThemeLike = {
  bg(color, text) {
    const start = color === "toolSuccessBg" ? addedBackground : color === "toolErrorBg" ? removedBackground : normalBackground;
    return `${start}${text}\x1b[49m`;
  },
  fg(color, text) {
    if (color === "toolDiffAdded") return `\x1b[38;5;34m${text}\x1b[39m`;
    if (color === "toolDiffRemoved") return `\x1b[38;5;196m${text}\x1b[39m`;
    return text;
  },
  getBgAnsi(color) {
    return color === "toolSuccessBg" ? addedBackground : color === "toolErrorBg" ? removedBackground : normalBackground;
  },
};

const widthHelpers: WidthHelpers = {
  visibleWidth(line) {
    return line.replace(ansiPattern, "").length;
  },
  truncateToWidth(line, width, _ellipsis, _preserveAnsi) {
    if (this.visibleWidth(line) <= width) return line;
    let result = "";
    let visible = 0;
    for (const token of line.split(/(\x1b\[[0-9;]*m)/g)) {
      if (ansiPattern.test(token)) {
        result += token;
        continue;
      }
      const remaining = width - visible;
      if (remaining <= 0) break;
      result += token.slice(0, remaining);
      visible += token.slice(0, remaining).length;
    }
    return result;
  },
};

function cardLine(text: string): string {
  return `${normalBackground}${text}\x1b[49m`;
}

test("wraps every tool card and highlights core renderDiff rows", () => {
  const lines = [
    cardLine("\x1b[38;5;196m  -12 removed\x1b[39m"),
    cardLine("\x1b[38;5;34m  +12 added\x1b[39m"),
  ];

  const rendered = renderToolMessage("edit", lines, 24, theme, widthHelpers);
  assert.equal(rendered[0], "");
  assert.ok(rendered[1]!.includes("tool(edit)"));
  assert.ok(rendered[2]!.startsWith(diffRemovedBackground));
  assert.ok(rendered[2]!.includes(diffRemovedBackground));
  assert.ok(rendered[3]!.startsWith(diffAddedBackground));
  assert.ok(rendered[3]!.includes(diffAddedBackground));
  assert.ok(!rendered[2]!.includes("\x1b[38;5;196m"));
  assert.ok(!rendered[3]!.includes("\x1b[38;5;34m"));

  const bash = renderToolMessage("bash", lines, 24, theme, widthHelpers);
  assert.equal(bash[0], "");
  assert.ok(bash[1]!.includes("tool(bash)"));
  assert.ok(bash[2]!.startsWith(addedBackground));
  assert.ok(bash[3]!.startsWith(addedBackground));
});

    test("closes the top border after the title at the requested width", () => {
      const rendered = renderToolMessage("mem_session_summary", [cardLine("output")], 40, theme, widthHelpers);
      assert.ok(rendered[1]!.endsWith("╮\x1b[49m"));
      assert.equal(widthHelpers.visibleWidth(rendered[1]!), 40);
    });

    test("preserves nested ANSI ordering and terminal width when replacing a diff row background", () => {
  const rendered = renderToolMessage(
    "write",
    [cardLine(`  \x1b[31m+7 \x1b[7madded\x1b[0m`)],
    24,
    theme,
    widthHelpers,
  )[2]!;

  assert.ok(rendered.includes(diffAddedBackground));
  assert.ok(rendered.includes(`\x1b[31m${diffAddedBackground}`));
  assert.ok(rendered.includes(`\x1b[7m${diffAddedBackground}`));
  assert.equal(widthHelpers.visibleWidth(rendered), 24);
});

test("continues the changed-row background through wrapped renderDiff rows but stops at context", () => {
  const rendered = renderToolMessage(
    "edit",
    [
      cardLine("  -42 a removed row"),
      cardLine("that continues after wrapping"),
          cardLine("╰────────────────╯"),
      cardLine("   43 unchanged context"),
    ],
    36,
    theme,
    widthHelpers,
  );

  assert.ok(rendered[2]!.includes(diffRemovedBackground));
  assert.ok(rendered[3]!.includes(diffRemovedBackground));
  assert.ok(rendered[4]!.includes(addedBackground));
  assert.ok(rendered[5]!.includes(addedBackground));
  assert.equal(rendered.length, 6);
});

test("caches stable tool renders and restores the tool renderer with the TUI lifecycle", async () => {
  let renderCalls = 0;
  const originalToolRender = function (): string[] {
    renderCalls += 1;
    return [cardLine("  +9 patched")];
  };
  const userPrototype = { render: () => ["user"], invalidate() {} } as unknown as PatchedPrototype & Renderable;
  const markdownPrototype = { render: () => ["markdown"] } as unknown as PatchedPrototype & Renderable;
  const toolPrototype = { render: originalToolRender } as unknown as PatchedPrototype & Renderable;
  const handlers = new Map<string, (event: unknown, context?: unknown) => Promise<void>>();
  const pi = { on(name: string, handler: (event: unknown, context?: unknown) => Promise<void>) { handlers.set(name, handler); } };

  registerUiOverhaulLifecycle(pi as never, userPrototype, markdownPrototype, widthHelpers, toolPrototype);
  const start = handlers.get("session_start");
  const shutdown = handlers.get("session_shutdown");
  assert.ok(start);
  assert.ok(shutdown);

  const context = { hasUI: true, mode: "tui", ui: { theme } };
  try {
    await start({}, context);
    const toolInstance = { toolName: "edit" };
    const rendered = toolPrototype.render.call(toolInstance, 20);
    const cached = toolPrototype.render.call(toolInstance, 20);
    assert.strictEqual(cached, rendered);
    assert.equal(renderCalls, 1);
    assert.equal(rendered[0], "");
    assert.ok(rendered[1]!.includes("tool(edit)"));
    assert.ok(rendered[2]!.includes(diffAddedBackground));

    await shutdown({});
    assert.strictEqual(toolPrototype.render, originalToolRender);
  } finally {
    restore(userPrototype);
    restore(markdownPrototype);
    restore(toolPrototype);
    setCurrentContext(undefined);
  }
});
