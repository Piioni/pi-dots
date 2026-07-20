export { registerPermissionModeRuntime } from "../../shared/permission-mode/runtime-registry";
import { MODES, getMode, getNextMode, isPermissionModeName } from "./policies";
import { writeCurrentMode, writePolicy } from "./persistence";
import type {
  PermissionMode,
  PermissionModeName,
  PermissionModeRuntimeAPI,
} from "./types";

export function createPermissionModeRuntime(initialMode: PermissionMode): PermissionModeRuntimeAPI {
  let currentMode = initialMode;
  const listeners = new Set<(mode: PermissionModeName) => void>();

  const publish = () => {
    for (const listener of listeners) listener(currentMode.name);
  };

  const setMode = (modeName: PermissionModeName): { mode?: PermissionModeName; error?: string } => {
    if (!isPermissionModeName(modeName)) return { error: `Unknown permission mode: ${modeName}` };

    currentMode = getMode(modeName);
    writeCurrentMode(currentMode);
    writePolicy(currentMode);
    publish();

    return { mode: currentMode.name };
  };

  return {
    getMode: () => currentMode.name,
    getModes: () => MODES.map((mode) => mode.name),
    setMode,
    cycle: () => {
      const result = setMode(getNextMode(currentMode.name).name);
      return { mode: result.mode ?? currentMode.name, error: result.error };
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

