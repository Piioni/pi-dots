import type { ExtensionAPI, ExtensionContext, ReadonlyFooterDataProvider } from "@earendil-works/pi-coding-agent";
import type { Theme } from "@earendil-works/pi-coding-agent";
import { showChangesOverlay } from "./changes-overlay.ts";
import { changesFingerprint, createChangesReader, renderChangesWidget, type ChangesModel } from "./changes.ts";
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
const DEFAULT_ACTIVE_WATCH_MS = 5000;
const DEFAULT_IDLE_WATCH_MS = 30_000;
const TOOL_REFRESH_DELAY_MS = 175;
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

type WatchPolicy = { kind: "adaptive" } | { kind: "disabled" } | { kind: "fixed"; intervalMs: number };

function watchPolicy(value: string | undefined): WatchPolicy {
  const normalized = value?.trim().toLowerCase();
  if (normalized === "off" || normalized === "0") return { kind: "disabled" };
  const parsed = Number.parseInt(normalized ?? "", 10);
  if (Number.isFinite(parsed) && parsed > 0) return { kind: "fixed", intervalMs: parsed };
  return { kind: "adaptive" };
}

function watchDelay(policy: WatchPolicy, active: boolean): number | undefined {
  if (policy.kind === "disabled") return undefined;
  if (policy.kind === "fixed") return policy.intervalMs;
  return active ? DEFAULT_ACTIVE_WATCH_MS : DEFAULT_IDLE_WATCH_MS;
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
  const changesReader = createChangesReader();
  let sessionToken: object | undefined;
  let root = "";
  let model: ChangesModel = { files: [], added: 0, deleted: 0 };
  let fingerprint = "";
  let pollTimer: NodeJS.Timeout | undefined;
  let pollGeneration = 0;
  let watchConfig: WatchPolicy = { kind: "adaptive" };
  let toolRefreshTimer: NodeJS.Timeout | undefined;
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
  type UsageRequest = {
    session: object;
    controller: AbortController;
    timer?: NodeJS.Timeout;
    promise: Promise<void>;
    release?: () => void;
  };
  let usageRequest: UsageRequest | undefined;

  const cancelUsageRequest = () => {
    const request = usageRequest;
    usageRequest = undefined;
    if (!request) return;
    clearTimeout(request.timer);
    request.controller.abort();
    request.release?.();
  };

  const refreshUsage = async (ctx: ExtensionContext, force: boolean) => {
    const activeToken = sessionToken;
    if (!activeToken || ctx.model?.provider !== CODEX_PROVIDER) return;
    if (usageRequest?.session === activeToken) return usageRequest.promise;
    if (!force && Date.now() - usageFetchedAt < 5 * 60_000) return;

    const request: UsageRequest = {
      session: activeToken,
      controller: new AbortController(),
      promise: Promise.resolve(),
    };
    usageFetchedAt = Date.now();
    usageRequest = request;
    let release!: () => void;
    const deadline = new Promise<void>((resolve) => { release = resolve; });
    request.release = release;
    request.timer = setTimeout(() => {
      if (usageRequest === request) usageRequest = undefined;
      request.controller.abort();
      release();
    }, 10_000);
    request.timer.unref();
    const isCurrent = () => usageRequest === request && sessionToken === request.session && !request.controller.signal.aborted;

    const work = (async () => {
      try {
        const token = await ctx.modelRegistry.getApiKeyForProvider(CODEX_PROVIDER).catch(() => undefined);
        if (!isCurrent() || !token) return;
        const accountId = accountIdFromToken(token);
        if (!accountId || !isCurrent()) return;
        const response = await fetch(CODEX_USAGE_URL, {
          signal: request.controller.signal,
          headers: {
            Authorization: `Bearer ${token}`,
            "chatgpt-account-id": accountId,
            originator: "pi",
            "User-Agent": "piioni-shell",
          },
        });
        if (!isCurrent() || !response.ok) return;
        const payload: unknown = await response.json();
        if (!isCurrent()) return;
        if (usage.recordCodexPayload(CODEX_PROVIDER, payload)) {
          invalidateFooter?.();
          requestRender?.();
        }
      } catch {
        // Usage is optional; auth/network failures must not affect the shell.
      }
    })();
    request.promise = Promise.race([work, deadline]).finally(() => {
      clearTimeout(request.timer);
      if (usageRequest === request) usageRequest = undefined;
    });
    return request.promise;
  };

  const stopPolling = () => {
    pollGeneration += 1;
    if (pollTimer) clearTimeout(pollTimer);
    pollTimer = undefined;
  };

  const armPolling = (ctx: ExtensionContext, token: object, expectedRoot: string, generation: number) => {
    if (generation !== pollGeneration || sessionToken !== token || root !== expectedRoot || pollTimer) return;
    const delay = watchDelay(watchConfig, workingState.active);
    if (delay === undefined) return;
    const timer = setTimeout(() => {
      if (pollTimer !== timer) return;
      pollTimer = undefined;
      if (generation !== pollGeneration || sessionToken !== token || root !== expectedRoot) return;
      const currentRefresh = refreshInFlight;
      if (currentRefresh) {
        void currentRefresh.finally(() => armPolling(ctx, token, expectedRoot, generation));
        return;
      }
      void refresh(ctx).finally(() => armPolling(ctx, token, expectedRoot, generation));
    }, delay);
    pollTimer = timer;
    timer.unref();
  };

  const restartPolling = (ctx: ExtensionContext) => {
    stopPolling();
    const token = sessionToken;
    const expectedRoot = root;
    if (token && expectedRoot) armPolling(ctx, token, expectedRoot, pollGeneration);
  };

  const stopToolRefresh = () => {
    if (toolRefreshTimer) clearTimeout(toolRefreshTimer);
    toolRefreshTimer = undefined;
  };

  const scheduleToolRefresh = (ctx: ExtensionContext) => {
    if (toolRefreshTimer || !sessionToken || !root) return;
    const scheduledToken = sessionToken;
    const scheduledRoot = root;
    toolRefreshTimer = setTimeout(() => {
      toolRefreshTimer = undefined;
      if (sessionToken !== scheduledToken || root !== scheduledRoot) return;
      void refresh(ctx);
    }, TOOL_REFRESH_DELAY_MS);
    toolRefreshTimer.unref();
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
        const next = await changesReader.read(gitRunner(pi, root), root);
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
    const latest = await changesReader.read(gitRunner(pi, root), root);
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
      const activeToken = sessionToken;
      await refreshUsage(ctx, true);
      if (activeToken && sessionToken === activeToken && ctx.mode === "tui") await showUsageOverlay(ctx, usage);
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
    cancelUsageRequest();
    stopToolRefresh();
    stopPolling();
    changesReader.clear();
    stopWorkingAnimation();
    sessionToken = undefined;
    root = "";
    watchConfig = watchPolicy(process.env.PIIONI_SHELL_CHANGES_WATCH_MS);
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
    const token = sessionToken;
    const pollRoot = root;
    const generation = pollGeneration;
    void refresh(ctx).finally(() => armPolling(ctx, token, pollRoot, generation));
  });

  pi.on("agent_start", (_event, ctx) => {
    if (!sessionToken) return;
    if (!workingState.active) {
      workingState.active = true;
      workingState.message = pickWorkingMessage();
      startWorkingAnimation();
      restartPolling(ctx);
    }
    requestRender?.();
  });
  pi.on("agent_settled", async (_event, ctx) => {
    const activeToken = sessionToken;
    if (!activeToken) return;
    stopWorkingAnimation();
    workingState.active = false;
    workingState.message = undefined;
    workingState.elapsedSeconds = 0;
    restartPolling(ctx);
    invalidateFooter?.();
    requestRender?.();
    stopToolRefresh();
    await refresh(ctx);
    if (sessionToken !== activeToken) return;
    void refreshUsage(ctx, false);
  });
  pi.on("tool_execution_end", (event, ctx) => {
    if (!sessionToken) return;
    const annotations = pi.getAllTools().find((tool) => tool.name === event.toolName)?.annotations;
    if (annotations?.readOnlyHint === true && annotations.destructiveHint !== true) return;
    scheduleToolRefresh(ctx);
  });
  pi.on("session_shutdown", (_event, ctx) => {
    cancelUsageRequest();
    stopToolRefresh();
    stopPolling();
    if (!sessionToken) return;
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
    changesReader.clear();
    requestRender = undefined;
    invalidateFooter = undefined;
    previousEditor = undefined;
  });
}
