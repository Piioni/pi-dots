import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { readCurrentMode, writeCurrentMode, writePolicy } from "./persistence";
import { createPermissionModeRuntime, registerPermissionModeRuntime } from "./runtime";

function notify(ctx: ExtensionContext, message: string): void {
  try {
    ctx.ui?.notify?.(message, "info");
  } catch {
    // Notifications are best-effort; mode switching should not fail without UI support.
  }
}

export default function permissionModeSwitcher(pi: ExtensionAPI) {
  const currentMode = readCurrentMode();
  const api = createPermissionModeRuntime(currentMode);
  registerPermissionModeRuntime(api);

  writeCurrentMode(currentMode);
  writePolicy(currentMode);

  pi.registerShortcut("alt+p", {
    description: "Cycle Pi permission mode: Palantír, Mithril Forge, Balrog.",
    handler: async (ctx) => {
      const api = globalThis.__piioniPermissionMode;
      if (!api) {
        notify(ctx, "Permission mode API unavailable.");
        return;
      }

      const result = api.cycle();
      if (result.error) {
        notify(ctx, result.error);
        return;
      }

      notify(ctx, `Permission mode switched to ${result.mode}.`);
    },
  });
}

export {};
