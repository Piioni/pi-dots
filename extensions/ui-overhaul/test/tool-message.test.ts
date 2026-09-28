import assert from "node:assert/strict";
import test from "node:test";
import { registerUiOverhaulLifecycle } from "../src/lifecycle.ts";
import { restore } from "../src/prototype-patches.ts";
import { setCurrentContext, type PatchedPrototype } from "../src/state.ts";
import { renderToolMessage } from "../src/tool-message.ts";
import type { Renderable, ThemeLike, WidthHelpers } from "../src/types.ts";

const ansiPattern = /\x1b\[[0-9;]*m/g;
const normalBackground = "\x1b[48;5;240m";
const addedBackground = "\x1b[48;5;22m";
const removedBackground = "\x1b[48;5;52m";
const diffAddedBackground = "\x1b[48;5;34m";
const diffRemovedBackground = "\x1b[48;5;196m";
const errorBorder = "\x1b[38;5;196m";

const theme: ThemeLike = {
  bg(color, text) {
    const start = color === "toolSuccessBg" ? addedBackground : color === "toolErrorBg" ? removedBackground : normalBackground;
    return `${start}${text}\x1b[49m`;
  },
  fg(color, text) {
    if (color === "toolDiffAdded") return `\x1b[38;5;34m${text}\x1b[39m`;
    if (color === "toolDiffRemoved" || color === "error") return `${errorBorder}${text}\x1b[39m`;
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

test("wraps every tool card and preserves native diff colors on the shared background", () => {
  const lines = [
    cardLine("\x1b[38;5;196m  -12 removed\x1b[39m"),
    cardLine("\x1b[38;5;34m  +12 added\x1b[39m"),
  ];

  const rendered = renderToolMessage("edit", lines, 24, theme, widthHelpers);
  assert.equal(rendered[0], "");
  assert.ok(rendered[1]!.includes("tool(edit)"));
  assert.ok(rendered[2]!.startsWith(normalBackground));
  assert.ok(rendered[2]!.includes("\x1b[38;5;196m"));
  assert.ok(!rendered[2]!.includes("\x1b[4m"));
  assert.ok(!rendered[2]!.includes(diffRemovedBackground));
  assert.ok(rendered[3]!.startsWith(normalBackground));
  assert.ok(rendered[3]!.includes("\x1b[38;5;34m"));
  assert.ok(!rendered[3]!.includes("\x1b[4m"));
  assert.ok(!rendered[3]!.includes(diffAddedBackground));

  const bash = renderToolMessage("bash", lines, 24, theme, widthHelpers);
  assert.equal(bash[0], "");
  assert.ok(bash[1]!.includes("tool(bash)"));
  assert.ok(bash[2]!.startsWith(addedBackground));
  assert.ok(bash[3]!.startsWith(addedBackground));

  const failed = renderToolMessage("bash", lines, 24, theme, widthHelpers, { isError: true });
  assert.ok(failed[1]!.startsWith(removedBackground));
  assert.ok(failed[1]!.includes(errorBorder));
  assert.ok(failed[failed.length - 1]!.includes(errorBorder));

  const failedEdit = renderToolMessage("edit", lines, 24, theme, widthHelpers, { isError: true });
  assert.ok(failedEdit[1]!.startsWith(removedBackground));
});

test("preserves split diff bars without adding row underlines", () => {
  const splitRow = (left: string, right: string): string =>
    cardLine(`${left.padEnd(28)} │ ${right.padEnd(29)}`);
  const lines = [
    splitRow("\x1b[38;5;196m▌\x1b[39m  70 │ removed value", "\x1b[38;5;34m▌\x1b[39m  70 │ added value"),
    splitRow("      │ wrapped old", "      │ wrapped new"),
    splitRow("   71 │ unchanged", "   71 │ unchanged"),
  ];

  const rendered = renderToolMessage("edit", lines, 60, theme, widthHelpers);

  assert.ok(rendered[2]!.includes("\x1b[38;5;196m"));
  assert.ok(rendered[2]!.includes("\x1b[38;5;34m"));
  assert.ok(rendered[2]!.includes("▌"));
  assert.ok(rendered.slice(2, 5).every((line) => !line.includes("\x1b[4m")));
  assert.ok(rendered.slice(2, 5).every((line) => line.startsWith(normalBackground)));
  assert.equal(widthHelpers.visibleWidth(rendered[2]!), 60);
});

test("hides completed hypa_read output while preserving its call line", () => {
      const lines = [
        cardLine("hypa_read /tmp/example.txt"),
        cardLine("first output line"),
        cardLine("second output line"),
      ];

      const completed = renderToolMessage(
        "hypa_read",
        lines,
        40,
        theme,
        widthHelpers,
        { isPartial: false },
      );
      assert.equal(completed.length, 4);
      assert.ok(completed[2]!.includes("hypa_read /tmp/example.txt"));
      assert.ok(!completed[2]!.includes("first output line"));

      const partial = renderToolMessage(
        "hypa_read",
        lines,
        40,
        theme,
        widthHelpers,
        { isPartial: true },
      );
      assert.equal(partial.length, 6);
      assert.ok(partial.some((line) => line.includes("first output line")));
    });

    test("hides completed hypa_grep output while preserving its call line", () => {
      const lines = [
        cardLine("hypa_grep needle /tmp"),
        cardLine("first match"),
        cardLine("second match"),
      ];

      const completed = renderToolMessage("hypa_grep", lines, 40, theme, widthHelpers, { isPartial: false });
      assert.equal(completed.length, 4);
      assert.ok(completed[2]!.includes("hypa_grep needle /tmp"));
      assert.ok(!completed[2]!.includes("first match"));

      const partial = renderToolMessage("hypa_grep", lines, 40, theme, widthHelpers, { isPartial: true });
      assert.equal(partial.length, 6);
      assert.ok(partial.some((line) => line.includes("first match")));
    });

    test("hides completed hypa_find output while preserving its call line", () => {
      const lines = [
        cardLine("hypa_find *.ts /tmp"),
        cardLine("first result"),
        cardLine("second result"),
      ];

      const completed = renderToolMessage("hypa_find", lines, 40, theme, widthHelpers, { isPartial: false });
      assert.equal(completed.length, 4);
      assert.ok(completed[2]!.includes("hypa_find *.ts /tmp"));
      assert.ok(!completed[2]!.includes("first result"));

      const partial = renderToolMessage("hypa_find", lines, 40, theme, widthHelpers, { isPartial: true });
      assert.equal(partial.length, 6);
      assert.ok(partial.some((line) => line.includes("first result")));
    });

        test("hides completed hypa_ls output while preserving its call line", () => {
          const lines = [
            cardLine("hypa_ls /tmp"),
            cardLine("first entry"),
            cardLine("second entry"),
          ];
    
          const completed = renderToolMessage("hypa_ls", lines, 40, theme, widthHelpers, { isPartial: false });
          assert.equal(completed.length, 4);
          assert.ok(completed[2]!.includes("hypa_ls /tmp"));
          assert.ok(!completed[2]!.includes("first entry"));
    
          const partial = renderToolMessage("hypa_ls", lines, 40, theme, widthHelpers, { isPartial: true });
          assert.equal(partial.length, 6);
          assert.ok(partial.some((line) => line.includes("first entry")));
        });
    
        test("hides completed hypa_shell output while preserving its call line", () => {
          const lines = [
            cardLine("hypa_shell pwd"),
            cardLine("/tmp/project"),
            cardLine("exit code: 0"),
          ];

          const completed = renderToolMessage("hypa_shell", lines, 40, theme, widthHelpers, { isPartial: false });
          assert.equal(completed.length, 4);
          assert.ok(completed[2]!.includes("hypa_shell pwd"));
          assert.ok(!completed[2]!.includes("/tmp/project"));

          const partial = renderToolMessage("hypa_shell", lines, 40, theme, widthHelpers, { isPartial: true });
          assert.equal(partial.length, 6);
          assert.ok(partial.some((line) => line.includes("/tmp/project")));
        });

        test("closes the top border after the title at the requested width", () => {
      const rendered = renderToolMessage("mem_session_summary", [cardLine("output")], 40, theme, widthHelpers);
      assert.ok(rendered[1]!.endsWith("╮\x1b[49m"));
      assert.equal(widthHelpers.visibleWidth(rendered[1]!), 40);
    });

    test("preserves nested ANSI ordering and terminal width without custom underlines", () => {
  const rendered = renderToolMessage(
    "write",
    [cardLine(`  \x1b[31m+7 \x1b[7madded\x1b[0m`)],
    24,
    theme,
    widthHelpers,
  )[2]!;

  assert.ok(rendered.startsWith(normalBackground));
  assert.ok(!rendered.includes("\x1b[4m"));
  assert.ok(!rendered.includes(diffAddedBackground));
  assert.ok(rendered.includes("\x1b[31m"));
  assert.ok(rendered.includes("\x1b[7m"));
  assert.equal(widthHelpers.visibleWidth(rendered), 24);
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
    assert.ok(rendered[2]!.startsWith(normalBackground));
    assert.ok(rendered[2]!.includes("+9 patched"));
    assert.ok(!rendered[2]!.includes("\x1b[4m"));
    assert.ok(!rendered[2]!.includes(diffAddedBackground));

    await shutdown({});
    assert.strictEqual(toolPrototype.render, originalToolRender);
  } finally {
    restore(userPrototype);
    restore(markdownPrototype);
    restore(toolPrototype);
    setCurrentContext(undefined);
  }
});
