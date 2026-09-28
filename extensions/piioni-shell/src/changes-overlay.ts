import { execFileSync } from "node:child_process";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { getSelectListTheme } from "@earendil-works/pi-coding-agent";
import { SelectList, type TUI } from "@earendil-works/pi-tui";
import type { ChangedFile, ChangesModel } from "./changes.ts";

function editorCommand(): string | undefined {
  return process.env.VISUAL || process.env.EDITOR;
}

function openInEditor(root: string, file: ChangedFile): boolean {
  const command = editorCommand();
  if (!command) return false;
  const [editor, ...args] = command.split(/\s+/u);
  if (!editor) return false;
  execFileSync(editor, [...args, file.path], { cwd: root, stdio: "inherit" });
  return true;
}

export async function showChangesOverlay(ctx: ExtensionContext, root: string, model: ChangesModel): Promise<void> {
  const selected = await ctx.ui.custom<string | undefined>((tui: TUI, _theme, _keybindings, done) => {
    const list = new SelectList(
      model.files.map((file) => ({
        value: file.path,
        label: `${file.status} ${file.path}`,
        description: `+${file.added} −${file.deleted}`,
      })),
      Math.min(12, Math.max(1, tui.terminal.rows - 8)),
      getSelectListTheme(),
    );
    list.onSelect = (item) => done(item.value);
    list.onCancel = () => done(undefined);
    return {
      render: (width) => list.render(width),
      invalidate: () => list.invalidate(),
      handleInput: (data) => {
        list.handleInput(data);
        tui.requestRender();
      },
    };
  }, { overlay: true, overlayOptions: { width: "90%", anchor: "center" } });

  if (selected === undefined) return;
  const file = model.files.find((item) => item.path === selected);
  if (!file) return;
  try {
    if (!openInEditor(root, file)) ctx.ui.notify("No editor configured. Set $VISUAL or $EDITOR.", "warning");
  } catch (error) {
    ctx.ui.notify(`Editor failed: ${error instanceof Error ? error.message : String(error)}`, "error");
  }
}
