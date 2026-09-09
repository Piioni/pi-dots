import type {
	ExtensionAPI,
	ExtensionContext,
	ReadonlyFooterDataProvider,
} from "@earendil-works/pi-coding-agent";
import { createLayoutRuntime } from "./layout-runtime";
import type { LayoutSnapshot } from "./layout-state";
import { makeFooter } from "./render/footer";
import type { RenderableTui } from "./types";

function safeSetLayout(
	ctx: ExtensionContext,
	activeTuis: Set<RenderableTui>,
	getSnapshot: () => LayoutSnapshot,
	refreshSnapshot: (footerData?: ReadonlyFooterDataProvider) => void,
): boolean {
	if (!ctx.hasUI || ctx.mode !== "tui") return false;
	if (typeof ctx.ui?.setFooter !== "function") return false;

	try {
		ctx.ui.setFooter(
			makeFooter(ctx, activeTuis, getSnapshot, refreshSnapshot),
		);
		return true;
	} catch {
		// Non-TUI modes or older UI implementations should keep running without layout changes.
		return false;
	}
}

export default function piioniLayout(pi: ExtensionAPI) {
	const runtime = createLayoutRuntime(pi);
	const activeTuis = new Set<RenderableTui>();
	let layoutInstalled = false;

	const requestRender = () => {
		for (const tui of activeTuis) tui.requestRender();
	};

	runtime.subscribe(requestRender);

	pi.on("session_start", (_event, ctx) => {
		runtime.startSession(ctx);
		if (layoutInstalled) return;

		layoutInstalled = safeSetLayout(
			ctx,
			activeTuis,
			() => runtime.getSnapshot(),
			(footerData) => runtime.captureFooterData(footerData),
		);
	});

	pi.on("model_select", (_event, ctx) => runtime.handleContextChange(ctx));
	pi.on("thinking_level_select", (_event, ctx) =>
		runtime.handleContextChange(ctx),
	);
	pi.on("turn_start", (_event, ctx) => runtime.handleContextChange(ctx));
	pi.on("turn_end", (_event, ctx) => runtime.handleContextChange(ctx));
	pi.on("before_agent_start", (_event, ctx) =>
		runtime.handleContextChange(ctx),
	);
	pi.on("tool_execution_end", (_event, ctx) => {
		void runtime.refreshWorkspace(ctx);
	});
	pi.on("input", (_event, ctx) => {
		void runtime.refreshWorkspace(ctx);
		return { action: "continue" };
	});

	pi.on("session_shutdown", (_event, ctx) => {
		layoutInstalled = false;
		runtime.shutdown();
		activeTuis.clear();

		try {
			ctx.ui.setStatus("piioni-layout", undefined);
			if (typeof ctx.ui?.setFooter === "function") {
				ctx.ui.setFooter(undefined);
			}
		} catch {
			// Cleanup is best-effort because shutdown may run without an interactive UI.
		}
	});
}
