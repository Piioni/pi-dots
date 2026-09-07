import type {
  ExtensionAPI,
  ExtensionContext,
  ReadonlyFooterDataProvider,
} from "@earendil-works/pi-coding-agent";
import { createWorkspaceStateStore } from "../../shared/workspace-state/store";
import {
  buildLayoutSnapshot,
  resolveInitialMode,
  type LayoutSnapshot,
} from "./layout-state";
import type { PermissionMode } from "./types";

interface LayoutRuntime {
  startSession(ctx: ExtensionContext): void;
  handleContextChange(ctx: ExtensionContext): void;
  refreshWorkspace(ctx?: ExtensionContext): Promise<void>;
  captureFooterData(footerData?: ReadonlyFooterDataProvider): void;
  getSnapshot(): LayoutSnapshot;
  subscribe(listener: () => void): () => void;
  shutdown(): void;
}

export function createLayoutRuntime(pi: ExtensionAPI): LayoutRuntime {
  let currentMode: PermissionMode = "default";
  let currentSnapshot: LayoutSnapshot | undefined;
  let currentContext: ExtensionContext | undefined;
  let lastFooterData: ReadonlyFooterDataProvider | undefined;
  let unsubscribeWorkspace: (() => void) | undefined;
  const listeners = new Set<() => void>();
  const workspaceStore = createWorkspaceStateStore();

  const notify = () => {
    for (const listener of listeners) listener();
  };

  const rebuildSnapshot = (
    ctx = currentContext,
    footerData = lastFooterData,
  ) => {
    if (!ctx) return;
    currentSnapshot = buildLayoutSnapshot(
      ctx,
      pi,
      currentMode,
      workspaceStore.getSnapshot(),
      footerData,
    );
  };

  const setContextState = (ctx: ExtensionContext) => {
    currentContext = ctx;
  };

  return {
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },

    startSession(ctx) {
      setContextState(ctx);
      currentMode = resolveInitialMode(ctx);
      lastFooterData = undefined;

      unsubscribeWorkspace?.();
      unsubscribeWorkspace = workspaceStore.subscribe(() => {
        rebuildSnapshot();
        notify();
      });

      rebuildSnapshot(ctx);
      notify();
      void this.refreshWorkspace(ctx);
    },

    handleContextChange(ctx) {
      setContextState(ctx);
      rebuildSnapshot(ctx);
      notify();
      void this.refreshWorkspace(ctx);
    },

    async refreshWorkspace(ctx = currentContext) {
      if (!ctx) return;
      await workspaceStore.refresh(ctx.cwd);
    },

    captureFooterData(footerData) {
      lastFooterData = footerData;
      rebuildSnapshot(undefined, footerData);
    },

    getSnapshot() {
      if (!currentSnapshot && currentContext) {
        rebuildSnapshot(currentContext);
      }
      if (!currentSnapshot) {
        throw new Error("piioni-layout snapshot requested before session_start");
      }
      return currentSnapshot;
    },

    shutdown() {
      currentContext = undefined;
      currentSnapshot = undefined;
      lastFooterData = undefined;
      unsubscribeWorkspace?.();
      unsubscribeWorkspace = undefined;
    },
  };
}
