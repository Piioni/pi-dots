import { spawn } from "node:child_process";

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

const MOSHI_HOOK = "/home/piioni/.local/bin/moshi-hook";
const PERMISSION_EVENT = "pi-permission-system:permission-request";

type PermissionState = "waiting" | "approved" | "denied";

type PermissionEvent = {
  requestId?: unknown;
  state?: unknown;
  message?: unknown;
  toolCallId?: unknown;
  toolName?: unknown;
};

type PiHookPayload = {
  hook_event_name: "PermissionRequest" | "PermissionResolved";
  session_id: string;
  transcript_path: string;
  cwd: string;
  model: string;
  context_remaining?: number;
  tool_name: string;
  tool_use_id: string;
  reason: string;
  description: string;
  permission_request_id: string;
  permission_state: PermissionState;
};

function firstString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function modelLabel(model: ExtensionContext["model"]): string {
  if (!model) return "";
  return model.name ?? model.id ?? "";
}

function contextRemaining(ctx: ExtensionContext): number | undefined {
  const percent = ctx.getContextUsage()?.percent;
  if (typeof percent !== "number" || !Number.isFinite(percent)) return undefined;
  return Math.max(1, Math.min(100, Math.round(100 - percent)));
}

function forwardToMoshi(payload: PiHookPayload): void {
  try {
    const child = spawn(MOSHI_HOOK, ["pi-hook"], {
      stdio: ["pipe", "ignore", "ignore"],
      windowsHide: true,
    });
    child.once("error", () => {});
    child.stdin.once("error", () => {});
    child.stdin.end(`${JSON.stringify(payload)}\n`);
    child.unref();
  } catch {
    // Moshi is optional; permission prompts must remain entirely local to Pi.
  }
}

function forwardPermissionEvent(event: PermissionEvent, ctx: ExtensionContext): void {
  const state = firstString(event.state);
  if (state !== "waiting" && state !== "approved" && state !== "denied") return;

  const message = firstString(event.message);
  forwardToMoshi({
    hook_event_name: state === "waiting" ? "PermissionRequest" : "PermissionResolved",
    session_id: ctx.sessionManager.getSessionId(),
    transcript_path: ctx.sessionManager.getSessionFile() ?? "",
    cwd: ctx.cwd,
    model: modelLabel(ctx.model),
    context_remaining: contextRemaining(ctx),
    tool_name: firstString(event.toolName),
    tool_use_id: firstString(event.toolCallId),
    reason: message,
    description: message,
    permission_request_id: firstString(event.requestId),
    permission_state: state,
  });
}

export default function moshiPermissionBridge(pi: ExtensionAPI): void {
  let activeContext: ExtensionContext | undefined;

  const captureContext = (_event: unknown, ctx: ExtensionContext): void => {
    activeContext = ctx;
  };

  pi.on("session_start", captureContext);
  pi.on("before_agent_start", captureContext);
  pi.on("agent_start", captureContext);
  pi.on("model_select", captureContext);

  pi.events.on(PERMISSION_EVENT, (data) => {
    if (!activeContext || !data || typeof data !== "object") return;
    forwardPermissionEvent(data as PermissionEvent, activeContext);
  });
}
