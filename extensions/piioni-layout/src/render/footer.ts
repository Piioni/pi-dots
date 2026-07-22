import type {
	ExtensionContext,
	ReadonlyFooterDataProvider,
} from "@earendil-works/pi-coding-agent";
import {
	colorDim,
	colorMode,
	colorPeach,
	colorSapphire,
	colorStatus,
	colorText,
	colorThinking,
} from "../colors";
import type { LayoutSnapshot } from "../layout-state";
import { truncate, widthOf } from "../format";
import type { DashboardRuntimeSnapshot } from "../../../shared/dashboard-state/types";
import { buildExtensionStatusFromSnapshot } from "../status";
import {
	selectResponsiveFooterPrimary,
	selectResponsiveFooterTokens,
} from "./responsive";
import type { PermissionMode, RenderableTui, WidgetComponent } from "../types";

function formatModeLabel(mode: PermissionMode): string {
	if (mode === "Palantír") return `👁  ${mode}`;
	if (mode === "Mithril Forge") return `⛏  ${mode}`;
	return `🜏  ${mode}`;
}

function formatMetricTokens(value: number | undefined): string {
	if (typeof value !== "number" || !Number.isFinite(value)) return "?";
	if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
	if (value >= 1_000) return `${(value / 1_000).toFixed(1)}k`;
	return `${value}`;
}

function formatMetricPercent(value: number | undefined): string {
	if (typeof value !== "number" || !Number.isFinite(value)) return "?%";
	return `${value.toFixed(1)}%`;
}

function metricPart(
	ctx: ExtensionContext,
	label: string,
	value: string,
	tone: "success" | "warning" | "error" | "accent" | "dim",
): string {
	return colorStatus(ctx, tone, `${label}${value}`);
}

function neutralMetricPart(
	ctx: ExtensionContext,
	label: string,
	value: string,
): string {
	return colorSapphire(ctx, `${label}${value}`);
}

function buildTokensLine(
	ctx: ExtensionContext,
	runtime: DashboardRuntimeSnapshot,
	width: number,
): string {
	const usage = runtime.usage;
	const input =
		typeof usage.input === "number"
			? neutralMetricPart(ctx, "↑", formatMetricTokens(usage.input))
			: undefined;
	const output =
		typeof usage.output === "number"
			? neutralMetricPart(ctx, "↓", formatMetricTokens(usage.output))
			: undefined;
	const cache =
		typeof usage.cacheRead === "number"
			? neutralMetricPart(ctx, "R", formatMetricTokens(usage.cacheRead))
			: undefined;

	const cacheHit =
		typeof usage.cacheRead === "number" &&
		typeof usage.input === "number" &&
		usage.cacheRead + usage.input > 0
			? metricPart(
					ctx,
					"CH",
					formatMetricPercent(
						(usage.cacheRead / (usage.cacheRead + usage.input)) * 100,
					),
					(usage.cacheRead / (usage.cacheRead + usage.input)) * 100 >= 90
						? "success"
						: (usage.cacheRead / (usage.cacheRead + usage.input)) * 100 >= 70
							? "accent"
							: "warning",
				)
			: undefined;

	const authIndicator = ctx.model
		? ctx.modelRegistry.isUsingOAuth(ctx.model)
			? `${colorText(ctx, " (sub)")}`
			: `${colorText(ctx, " (api)")}`
		: "";

	const cost =
		typeof usage.cost === "number"
			? `${colorPeach(ctx, "$")}${colorPeach(ctx, usage.cost.toFixed(3))}${authIndicator}`
			: undefined;

	const decision = selectResponsiveFooterTokens({
		width,
		input,
		output,
		cache,
		cacheHit,
		cost,
	});

	if (decision.parts.length === 0) return "";
	return `${colorText(ctx, "Tokens: ")}${decision.parts.join(" ")}`;
}

function buildContextSummary(
	ctx: ExtensionContext,
	runtime: DashboardRuntimeSnapshot,
): string {
	const context = runtime.context;
	if (
		typeof context.percent !== "number" &&
		typeof context.tokens !== "number" &&
		typeof context.contextWindow !== "number"
	) {
		return "";
	}

	const contextText = [
		formatMetricPercent(context.percent),
		typeof context.contextWindow === "number"
			? `/${formatMetricTokens(context.contextWindow)}`
			: typeof context.tokens === "number"
				? `/${formatMetricTokens(context.tokens)}`
				: "",
	].join("");

	const coloredValue = colorStatus(
		ctx,
		typeof context.percent === "number"
			? context.percent >= 90
				? "error"
				: context.percent >= 75
					? "warning"
					: context.percent >= 50
						? "accent"
						: "success"
			: "dim",
		contextText,
	);

	return `${colorText(ctx, "Contexto: ")}${coloredValue}`;
}

export function makeFooter(
	ctx: ExtensionContext,
	activeTuis: Set<RenderableTui>,
	getSnapshot: () => LayoutSnapshot,
	refreshSnapshot: (footerData?: ReadonlyFooterDataProvider) => void,
): (
	tui: RenderableTui,
	_theme: unknown,
	footerData: ReadonlyFooterDataProvider,
) => WidgetComponent {
	return (tui, _theme, footerData) => {
		activeTuis.add(tui);
		const unsubscribeBranch = footerData.onBranchChange(() => {
			refreshSnapshot(footerData);
			tui.requestRender();
		});

		return {
			dispose() {
				unsubscribeBranch();
				activeTuis.delete(tui);
			},
			invalidate() {},
			render(width: number): string[] {
				if (width <= 0) return [];

				refreshSnapshot(footerData);
				const snapshot = getSnapshot();
				const runtime = snapshot.dashboard.runtime;
				const left = [
					colorMode(ctx, snapshot.mode, formatModeLabel(snapshot.mode)),
					`${colorText(ctx, runtime.modelId)} ${colorDim(ctx, runtime.providerId)}`,
					colorThinking(ctx, runtime.thinkingLevel),
				].join(" • ");
				const contextSummary = buildContextSummary(ctx, runtime);
				const pullRequestSummary = snapshot.workspace.pullRequest
					? colorText(
							ctx,
							`PR #${snapshot.workspace.pullRequest.number}${snapshot.workspace.pullRequest.isDraft ? " draft" : ""}`,
						)
					: "";
				const primaryDecision = selectResponsiveFooterPrimary({
					width,
					left,
					context: contextSummary || undefined,
					pullRequest: pullRequestSummary || undefined,
				});
				const workspaceStatus = primaryDecision.right;
				const usage = buildTokensLine(ctx, runtime, width);
				const extensionStatus = buildExtensionStatusFromSnapshot(
					ctx,
					snapshot.dashboard.extensions,
				);
				const primaryGap = width - widthOf(left) - widthOf(workspaceStatus);
				const lines =
					workspaceStatus && primaryGap > 1
						? [`${left}${" ".repeat(primaryGap)}${workspaceStatus}`]
						: [
								truncate(left, width),
								...(workspaceStatus
									? [
											`${" ".repeat(Math.max(0, width - widthOf(workspaceStatus)))}${truncate(workspaceStatus, width)}`,
										]
									: []),
							];

				if (usage) lines.push(truncate(usage, width));
				if (extensionStatus) lines.push(truncate(extensionStatus, width));

				return lines;
			},
		};
	};
}
