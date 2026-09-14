import assert from "node:assert/strict";
import test from "node:test";
import {
  activateInlineCodeControl,
  decorateAssistantCodeControls,
  getInlineCodeControls,
  installAssistantCodeControls,
  setInlineControlTargets,
} from "./assistant-code-controls.ts";
import { registerUiOverhaulLifecycle } from "./lifecycle.ts";
import { restore } from "./prototype-patches.ts";
import { setCurrentContext, type PatchedPrototype } from "./state.ts";
import type { AssistantMessageLike, Renderable, WidthHelpers } from "./types.ts";

class FakeMarkdown implements Renderable {
  readonly id: string;

  constructor(id: string) {
    this.id = id;
  }

  render(_width: number): string[] {
    return [this.id];
  }

  invalidate(): void {}

  setText(_text: string): void {}
}

const message = (text: string): AssistantMessageLike => ({
  content: [{ type: "text", text }],
});

const wrapMouseRegion = (child: Renderable, onMouse: unknown): object => ({ child, onMouse });

const widthHelpers: WidthHelpers = {
  visibleWidth: (line) => line.length,
  truncateToWidth: (line, width) => line.slice(0, width),
};

test("constructs the original assistant transcript before decorating every complete source block", () => {
  const markdown = new FakeMarkdown("first");
  const component = {
    children: [] as unknown[],
    contentContainer: { children: [] as unknown[] },
    updateContent(source: AssistantMessageLike) {
      this.children = [this.contentContainer];
      this.contentContainer.children = [markdown];
      assert.equal(source.content[0]?.type, "text");
    },
  };
  const copied: string[] = [];

  installAssistantCodeControls(component, {
    onCopy: (block) => { copied.push(block.code); },
    wrapMouseRegion,
  });
  component.updateContent(message("```ts\none()\n```\n```py\ntwo()\n```"));

  const controls = getInlineCodeControls(markdown);
  assert.deepEqual(controls?.map((control) => control.block.code), ["one()", "two()"]);
  assert.notStrictEqual(component.contentContainer.children[0], markdown);
  assert.equal(component.children[0], component.contentContainer);
  assert.deepEqual(copied, []);
});

test("validates the complete child shape atomically and leaves incompatible rendering unchanged", () => {
  const markdown = new FakeMarkdown("first");
  const component = {
    children: [] as unknown[],
    contentContainer: { children: [] as unknown[] },
  };
  component.children = [component.contentContainer, {}];
  component.contentContainer.children = [markdown];

  const decorated = decorateAssistantCodeControls(
    component,
    message("```ts\none()\n```"),
    { onCopy: () => {}, wrapMouseRegion },
  );

  assert.equal(decorated, false);
  assert.strictEqual(component.contentContainer.children[0], markdown);
  assert.equal(getInlineCodeControls(markdown), undefined);
});

test("installs and restores fullscreen controls through lifecycle while streaming eligibility changes", async () => {
  const markdownPrototype = {
    render() { return ["markdown"]; },
    invalidate() {},
  } as unknown as PatchedPrototype & Renderable;
  const userPrototype = { render() { return ["user"]; }, invalidate() {} } as unknown as PatchedPrototype & Renderable;
  const assistantPrototype = {
    updateContent(this: { children: unknown[]; contentContainer: { children: unknown[] } }) {
      this.children = [this.contentContainer];
      this.contentContainer.children = [new FakeMarkdown("stream")];
    },
  } as unknown as PatchedPrototype;
  const handlers = new Map<string, (event: unknown, context?: unknown) => Promise<void>>();
  const pi = { on(name: string, handler: (event: unknown, context?: unknown) => Promise<void>) { handlers.set(name, handler); } };

  registerUiOverhaulLifecycle(pi as never, userPrototype, markdownPrototype, widthHelpers, undefined, assistantPrototype);
  const start = handlers.get("session_start")!;
  const shutdown = handlers.get("session_shutdown")!;
  const assistant = Object.assign(Object.create(assistantPrototype), { children: [] as unknown[], contentContainer: { children: [] as unknown[] } });
  try {
    await start({}, { hasUI: true, mode: "tui", ui: { theme: {} } });
    assistant.updateContent(message("```ts\npartial"));
    const partialMarkdown = assistant.contentContainer.children[0] as FakeMarkdown;
    assert.equal(getInlineCodeControls(partialMarkdown), undefined);

    assistant.updateContent(message("```ts\ncomplete()\n```"));
    const completeMarkdown = assistant.contentContainer.children[0] as FakeMarkdown;
    assert.deepEqual(getInlineCodeControls(completeMarkdown)?.map((control) => control.block.code), ["complete()"]);

    await shutdown({});
    assert.equal((assistantPrototype.updateContent as Function).name, "updateContent");
  } finally {
    restore(userPrototype);
    restore(markdownPrototype);
    restore(assistantPrototype);
    setCurrentContext(undefined);
  }
});

test("activates only the locally rendered Copy target and leaves unrelated mouse events untouched", () => {
  const markdown = new FakeMarkdown("first");
  const copied: string[] = [];
  const source = message("```ts\none()\n```\n```py\ntwo()\n```");
  const component = { children: [] as unknown[], contentContainer: { children: [markdown] } };
  component.children = [component.contentContainer];
  assert.equal(decorateAssistantCodeControls(component, source, {
    onCopy: (block) => { copied.push(block.code); },
    wrapMouseRegion,
  }), true);

  setInlineControlTargets(markdown, [
    { blockIndex: 1, row: 0, start: 12, end: 18 },
    { blockIndex: 2, row: 4, start: 12, end: 18 },
  ]);

  assert.equal(activateInlineCodeControl(markdown, { type: "wheel", button: "none", x: 13, y: 0 }), undefined);
  assert.equal(activateInlineCodeControl(markdown, { type: "click", button: "left", x: 10, y: 0 }), undefined);
  assert.deepEqual(activateInlineCodeControl(markdown, { type: "click", button: "left", x: 13, y: 4 }), { handled: true, render: true });
  assert.deepEqual(copied, ["two()"]);
});
