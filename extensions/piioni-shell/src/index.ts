import type { ExtensionAPI, ExtensionContext, ReadonlyFooterDataProvider } from "@earendil-works/pi-coding-agent";
import type { Theme } from "@earendil-works/pi-coding-agent";
import { showChangesOverlay } from "./changes-overlay.ts";
import { changesFingerprint, readChanges, renderChangesWidget, type ChangesModel } from "./changes.ts";
import {
  accountIdFromToken,
  buildFooterModel,
  CODEX_PROVIDER,
  CODEX_USAGE_URL,
  createUsageStore,
  renderFooter,
} from "./footer.ts";
import { PiioniPromptEditor, type PromptWorkingState } from "./prompt.ts";
import { showUsageOverlay } from "./usage-overlay.ts";
import { pickWorkingMessage } from "./working-messages.ts";

const CHANGES_WIDGET = "piioni-shell-changes";
const CHANGES_COMMAND = "gentle:changes";
const USAGE_COMMAND = "gentle:usage";
const DEFAULT_WATCH_MS = 5000;
const FOOTER_CACHE_MS = 1000;
const DEFAULT_SHORTCUT = "alt+g";
const WORKING_ANIMATION_MS = 500;
const WORKING_SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"] as const;

type FooterComponent = {
  render(width: number): string[];
  invalidate(): void;
  dispose?(): void;
};

type ShellTheme = Pick<Theme, "fg" | "bold">;

function positiveMs(value: string | undefined, fallback: number): number | undefined {
  const normalized = value?.trim().toLowerCase();
  if (normalized === "off" || normalized === "0") return undefined;
  const parsed = Number.parseInt(normalized ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function gitRunner(pi: ExtensionAPI, root: string) {
  return async (args: string[]) => {
    const result = await pi.exec("git", ["-C", root, ...args], { timeout: 5000 });
    return { stdout: result.stdout, code: result.code };
  };
}

function footerFactory(
  pi: ExtensionAPI,
  ctx: ExtensionContext,
  footerData: ReadonlyFooterDataProvider,
  dirty: () => number,
  usage: ReturnType<typeof createUsageStore>,
  registerInvalidator: (invalidate: () => void) => () => void,
) {
  return (tui: { requestRender(): void }, theme: ShellTheme): FooterComponent => {
    let cachedAt = 0;
    let cachedWidth = -1;
    let cachedLines: string[] | undefined;
    const component: FooterComponent = {
      render(width) {
        const now = Date.now();
        if (cachedLines && cachedWidth === width && now - cachedAt < FOOTER_CACHE_MS) return cachedLines;
        cachedAt = now;
        cachedWidth = width;
        cachedLines = renderFooter(
          buildFooterModel(pi, ctx, footerData, dirty(), usage.get(ctx.model?.provider ?? "")),
          theme,
          width,
        );
        return cachedLines;
      },
      invalidate() {
        cachedAt = 0;
        cachedWidth = -1;
        cachedLines = undefined;
      },
      dispose() {},
    };
    const invalidate = () => component.invalidate();
    const unregisterInvalidator = registerInvalidator(invalidate);
    const unsubscribeBranch = footerData.onBranchChange(() => {
      invalidate();
      tui.requestRender();
    });
    component.dispose = () => {
      unsubscribeBranch();
      unregisterInvalidator();
    };
    return component;
  };
}

function shellEnabled(): boolean {
  const value = process.env.PIIONI_SHELL?.trim().toLowerCase();
  return value !== "0" && value !== "false" && value !== "off";
}

export default function piioniShell(pi: ExtensionAPI): void {
  if (!shellEnabled()) return;

  const usage = createUsageStore();
  let sessionToken: object | undefined;
  let root = "";
  let model: ChangesModel = { files: [], added: 0, deleted: 0 };
  let fingerprint = "";
  let watch: NodeJS.Timeout | undefined;
  let refreshInFlight: Promise<void> | undefined;
  let refreshGeneration = 0;
  let refreshPending = false;
  let requestRender: (() => void) | undefined;
  let invalidateFooter: (() => void) | undefined;
  const workingState: {
    active: boolean;
    message?: string;
    spinnerFrame: string;
    elapsedSeconds: number;
  } = {
    active: false,
    spinnerFrame: WORKING_SPINNER_FRAMES[0],
    elapsedSeconds: 0,
  };
  let workingAnimation: NodeJS.Timeout | undefined;
  let previousEditor: Parameters<ExtensionContext["ui"]["setEditorComponent"]>[0];
  let usageFetchedAt = 0;

  const refreshUsage = async (ctx: ExtensionContext, force: boolean) => {
    const activeToken = sessionToken;
    try {
      if (!activeToken || ctx.model?.provider !== CODEX_PROVIDER) return;
      const now = Date.now();
      if (!force && now - usageFetchedAt < 5 * 60_000) return;
      usageFetchedAt = now;
      const token = await ctx.modelRegistry.getApiKeyForProvider(CODEX_PROVIDER).catch(() => undefined);
      if (sessionToken !== activeToken || !token) return;
      const accountId = accountIdFromToken(token);
      if (!accountId) return;
      const response = await fetch(CODEX_USAGE_URL, {
        headers: {
          Authorization: `Bearer ${token}`,
          "chatgpt-account-id": accountId,
          originator: "pi",
          "User-Agent": "piioni-shell",
        },
      });
      if (sessionToken !== activeToken || !response.ok) return;
      const payload: unknown = await response.json();
      if (sessionToken !== activeToken) return;
      if (usage.recordCodexPayload(CODEX_PROVIDER, payload)) {
        invalidateFooter?.();
        requestRender?.();
      }
    } catch {
      // Usage is optional; auth/network failures must not affect the shell.
    }
  };

  const stopWatch = () => {
    if (watch) clearInterval(watch);
    watch = undefined;
  };

  const stopWorkingAnimation = () => {
    if (workingAnimation) clearInterval(workingAnimation);
    workingAnimation = undefined;
  };

  const startWorkingAnimation = () => {
    stopWorkingAnimation();
    const startedAt = Date.now();
    let frameIndex = 0;
    workingState.spinnerFrame = WORKING_SPINNER_FRAMES[frameIndex];
    workingState.elapsedSeconds = 0;
    workingAnimation = setInterval(() => {
      if (!sessionToken || !workingState.active) {
        stopWorkingAnimation();
        return;
      }
      frameIndex = (frameIndex + 1) % WORKING_SPINNER_FRAMES.length;
      const elapsedSeconds = Math.floor((Date.now() - startedAt) / 1000);
      const frameChanged = workingState.spinnerFrame !== WORKING_SPINNER_FRAMES[frameIndex];
      const elapsedChanged = workingState.elapsedSeconds !== elapsedSeconds;
      workingState.spinnerFrame = WORKING_SPINNER_FRAMES[frameIndex];
      workingState.elapsedSeconds = elapsedSeconds;
      if (frameChanged || elapsedChanged) requestRender?.();
    }, WORKING_ANIMATION_MS);
    workingAnimation.unref();
  };

  const refresh = (ctx: ExtensionContext): Promise<void> => {
    if (refreshInFlight) {
      refreshPending = true;
      return refreshInFlight;
    }

    const activeToken = sessionToken;
    const generation = refreshGeneration;
    const operation = (async () => {
      try {
        if (!root || !activeToken) return;
        const next = await readChanges(gitRunner(pi, root), root);
        if (!next || sessionToken !== activeToken) return;
        const nextFingerprint = changesFingerprint(next);
        if (nextFingerprint === fingerprint) return;
        fingerprint = nextFingerprint;
        model = next;
        invalidateFooter?.();
        if (model.files.length === 0) ctx.ui.setWidget(CHANGES_WIDGET, undefined);
        else {
          ctx.ui.setWidget(CHANGES_WIDGET, (tui, theme) => ({
            render: (width) => renderChangesWidget(model, theme, width),
            invalidate() {},
            dispose() { void tui; },
          }), { placement: "belowEditor" });
        }
        requestRender?.();
      } catch {
        // `/reload` can invalidate a queued refresh between the checks above.
        // A stale refresh must never surface as an uncaught exception.
      }
    })();
    let settled: Promise<void>;
    settled = operation.finally(() => {
      if (refreshInFlight !== settled) return;
      const rerun = refreshPending;
      refreshPending = false;
      refreshInFlight = undefined;
      if (rerun && refreshGeneration === generation && sessionToken === activeToken) void refresh(ctx);
    });
    refreshInFlight = settled;

    return settled;
  };

  const openChanges = async (ctx: ExtensionContext) => {
    if (ctx.mode !== "tui" || !root) return;
    const latest = await readChanges(gitRunner(pi, root), root);
    if (!latest || latest.files.length === 0) {
      ctx.ui.notify("No changes in the working tree.", "info");
      return;
    }
    await showChangesOverlay(ctx, root, latest);
  };

  pi.registerCommand(CHANGES_COMMAND, {
    description: "Browse working-tree changes and open a file in $EDITOR.",
    handler: async (_args, ctx) => openChanges(ctx),
  });
  pi.registerShortcut(DEFAULT_SHORTCUT, {
    description: "Open working-tree changes",
    handler: async (ctx) => openChanges(ctx),
  });
  pi.registerCommand(USAGE_COMMAND, {
    description: "Show provider subscription usage and refresh Codex limits.",
    handler: async (_args, ctx) => {
      await refreshUsage(ctx, true);
      if (ctx.mode === "tui") await showUsageOverlay(ctx, usage);
    },
  });

  pi.on("after_provider_response", (event) => {
    if (usage.record(CODEX_PROVIDER, event.headers) || usage.record("anthropic", event.headers)) {
      invalidateFooter?.();
      requestRender?.();
    }
  });

  const invalidateFooterAndRender = () => {
    invalidateFooter?.();
    requestRender?.();
  };
  pi.on("model_select", invalidateFooterAndRender);
  pi.on("thinking_level_select", invalidateFooterAndRender);
  pi.on("session_info_changed", invalidateFooterAndRender);
  pi.on("session_tree", invalidateFooterAndRender);
  pi.on("session_compact", invalidateFooterAndRender);

  pi.on("session_start", async (_event, ctx) => {
    stopWatch();
    stopWorkingAnimation();
    sessionToken = undefined;
    requestRender = undefined;
    invalidateFooter = undefined;
    previousEditor = undefined;
    workingState.active = false;
    workingState.message = undefined;
    workingState.spinnerFrame = WORKING_SPINNER_FRAMES[0];
    workingState.elapsedSeconds = 0;
    usageFetchedAt = 0;
    refreshGeneration += 1;
    refreshInFlight = undefined;
    refreshPending = false;
    model = { files: [], added: 0, deleted: 0 };
    fingerprint = "";
    if (!ctx.hasUI || ctx.mode !== "tui") return;
    sessionToken = {};
    root = ctx.cwd;
    void refreshUsage(ctx, true);
    ctx.ui.setFooter((tui, theme, data) => {
      requestRender = () => tui.requestRender();
      const registerInvalidator = (invalidate: () => void) => {
        invalidateFooter = invalidate;
        return () => {
          if (invalidateFooter === invalidate) invalidateFooter = undefined;
        };
      };
      return footerFactory(pi, ctx, data, () => model.files.length, usage, registerInvalidator)(tui, theme);
    });

    // The editor reads this shared state during render, so an early agent_start
    // cannot lose its message before Pi creates the editor component.
    ctx.ui.setWorkingMessage();
    ctx.ui.setWorkingVisible(false);
    previousEditor = ctx.ui.getEditorComponent();
    const promptWorkingState: PromptWorkingState = workingState;
    ctx.ui.setEditorComponent((tui, theme, keybindings) => {
      requestRender = () => tui.requestRender();
      return new PiioniPromptEditor(tui, theme, keybindings, ctx, promptWorkingState);
    });
    void refresh(ctx);
    const watchMs = positiveMs(process.env.PIIONI_SHELL_CHANGES_WATCH_MS, DEFAULT_WATCH_MS);
    if (watchMs) {
      watch = setInterval(() => void refresh(ctx), watchMs);
      watch.unref();
    }
  });

  pi.on("agent_start", (_event, _ctx) => {
    if (!sessionToken) return;
    if (!workingState.active) {
      workingState.active = true;
      workingState.message = pickWorkingMessage();
      startWorkingAnimation();
    }
    requestRender?.();
  });
  pi.on("agent_settled", async (_event, ctx) => {
    if (!sessionToken) return;
    stopWorkingAnimation();
    workingState.active = false;
    workingState.message = undefined;
    workingState.elapsedSeconds = 0;
    invalidateFooter?.();
    requestRender?.();
    await refresh(ctx);
    void refreshUsage(ctx, false);
  });
  pi.on("tool_execution_end", async (_event, ctx) => {
    if (sessionToken) await refresh(ctx);
  });
  pi.on("session_shutdown", (_event, ctx) => {
    if (!sessionToken) return;
    stopWatch();
    stopWorkingAnimation();
    ctx.ui.setWidget(CHANGES_WIDGET, undefined);
    ctx.ui.setFooter(undefined);
    ctx.ui.setEditorComponent(previousEditor);
    ctx.ui.setWorkingMessage();
    ctx.ui.setWorkingVisible(true);
    workingState.active = false;
    workingState.message = undefined;
    workingState.spinnerFrame = WORKING_SPINNER_FRAMES[0];
    workingState.elapsedSeconds = 0;
    sessionToken = undefined;
    refreshPending = false;
    root = "";
    requestRender = undefined;
    invalidateFooter = undefined;
    previousEditor = undefined;
  });
}
