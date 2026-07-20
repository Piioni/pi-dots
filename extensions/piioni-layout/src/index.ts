import type {
  ExtensionAPI,
  ExtensionContext,
  ReadonlyFooterDataProvider,
} from "@earendil-works/pi-coding-agent";
import { createLayoutRuntime } from "./layout-runtime";
import type { LayoutSnapshot } from "./layout-state";
import { makeAboveEditorWidget } from "./render/above-editor";
import { makeFooter } from "./render/footer";
import type { RenderableTui } from "./types";

function safeSetLayout(
  ctx: ExtensionContext,
  activeTuis: Set<RenderableTui>,
  getSnapshot: () => LayoutSnapshot,
  refreshSnapshot: (footerData?: ReadonlyFooterDataProvider) => void,
): void {
  if (!ctx.hasUI || ctx.mode !== "tui") return;
  if (typeof ctx.ui?.setWidget !== "function") return;

  try {
    ctx.ui.setWidget("piioni-layout-cwd", (tui) => {
      activeTuis.add(tui);
      return makeAboveEditorWidget(ctx, activeTuis, tui, getSnapshot);
    });

    if (typeof ctx.ui?.setFooter === "function") {
      ctx.ui.setFooter(
        makeFooter(ctx, activeTuis, getSnapshot, refreshSnapshot),
      );
    }
  } catch {
    // Non-TUI modes or older UI implementations should keep running without layout changes.
  }
}

export default function piioniLayout(pi: ExtensionAPI) {
  const runtime = createLayoutRuntime(pi);
  const activeTuis = new Set<RenderableTui>();

  const requestRender = () => {
    for (const tui of activeTuis) tui.requestRender();
  };

  runtime.subscribe(requestRender);

  pi.on("session_start", (_event, ctx) => {
    runtime.startSession(ctx);
    safeSetLayout(
      ctx,
      activeTuis,
      () => runtime.getSnapshot(),
      (footerData) => runtime.captureFooterData(footerData),
    );
  });

  pi.on("model_select", (_event, ctx) => runtime.handleContextChange(ctx));
  pi.on("thinking_level_select", (_event, ctx) => runtime.handleContextChange(ctx));
  pi.on("turn_start", (_event, ctx) => runtime.handleContextChange(ctx));
  pi.on("turn_end", (_event, ctx) => runtime.handleContextChange(ctx));
  pi.on("before_agent_start", (_event, ctx) => runtime.handleContextChange(ctx));
  pi.on("tool_execution_end", (_event, ctx) => {
    void runtime.refreshWorkspace(ctx);
  });
  pi.on("input", (_event, ctx) => {
    void runtime.refreshWorkspace(ctx);
    return { action: "continue" };
  });

  pi.on("session_shutdown", (_event, ctx) => {
    runtime.shutdown();

    try {
      ctx.ui.setWidget("piioni-layout-cwd", undefined);
      ctx.ui.setStatus("piioni-layout", undefined);
      if (typeof ctx.ui?.setFooter === "function") {
        ctx.ui.setFooter(undefined);
      }
    } catch {
      // Cleanup is best-effort because shutdown may run without an interactive UI.
    }
  });
}

// TODO: Editor border/theme coloring by permission mode is intentionally deferred.
// Replacing or subclassing the built-in editor risks conflicting with Gentle's layout/theme customizations.

export {};
