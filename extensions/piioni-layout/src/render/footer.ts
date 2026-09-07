import type {
	ExtensionContext,
	ReadonlyFooterDataProvider,
} from "@earendil-works/pi-coding-agent";
import {
	colorCwd,
	colorGit,
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
	selectResponsiveHeader,
} from "./responsive";
import type { RenderableTui, WidgetComponent } from "../types";

function buildGitStateText(snapshot: LayoutSnapshot): string {
	const gitState = snapshot.workspace.gitState;
	if (!gitState) return "";

	const progress = gitState.progress?.current && gitState.progress?.total
		? ` ${gitState.progress.current}/${gitState.progress.total}`
		: "";

	return `${gitState.label}${progress}`;
}

function buildWorkspaceSummary(
	ctx: ExtensionContext,
	snapshot: LayoutSnapshot,
	width: number,
): string {
	const decision = selectResponsiveHeader({
		width,
		cwd: snapshot.cwd,
		branch: snapshot.workspace.branch ? ` ${snapshot.workspace.branch}` : undefined,
		gitState: buildGitStateText(snapshot) || undefined,
	});
	const parts = [colorCwd(ctx, decision.cwd)];

	if (decision.branch || decision.gitState) {
		parts.push(colorText(ctx, "->"));
	}
	if (decision.branch) parts.push(colorGit(ctx, decision.branch));
	if (decision.gitState) parts.push(colorPeach(ctx, decision.gitState));

	return parts.join(" ");
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

function neutralMetricPart(
	ctx: ExtensionContext,
	label: string,
	value: string,
): string {
	return colorSapphire(ctx, `${label}${value}`);
}

function cacheMetricPart(
	ctx: ExtensionContext,
	label: string,
	value: string,
): string {
	return colorPeach(ctx, `${label}${value}`);
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
			? cacheMetricPart(ctx, "R", formatMetricTokens(usage.cacheRead))
			: undefined;

	const cacheHit =
		typeof usage.cacheRead === "number" &&
		typeof usage.input === "number" &&
		usage.cacheRead + usage.input > 0
			? cacheMetricPart(
					ctx,
					"CH",
					formatMetricPercent(
						(usage.cacheRead / (usage.cacheRead + usage.input)) * 100,
					),
				)
			: undefined;

	const decision = selectResponsiveFooterTokens({
		width,
		input,
		output,
		cache,
		cacheHit,
	});

	if (decision.parts.length === 0) return "";
	return `${colorText(ctx, "Tokens: ")}${decision.parts.join(" ")}`;
}

function buildContextSummary(
	ctx: ExtensionContext,
	runtime: DashboardRuntimeSnapshot,
): string {
	const context = runtime.context;
	const percent =
		typeof context.percent === "number"
			? context.percent
			: typeof context.tokens === "number" &&
				  typeof context.contextWindow === "number" &&
				  context.contextWindow > 0
				? (context.tokens / context.contextWindow) * 100
				: undefined;

	if (typeof percent !== "number") return "";

	const clampedPercent = Math.max(0, Math.min(100, percent));
	const filled = Math.round(clampedPercent / 10);
	const bar = `${"=".repeat(filled)}${".".repeat(10 - filled)}`;
	const tone =
		clampedPercent >= 90
			? "error"
			: clampedPercent >= 75
				? "warning"
				: clampedPercent >= 50
					? "accent"
					: "success";

	return colorStatus(
		ctx,
		tone,
		`ctx [${bar}] ${Math.round(clampedPercent)}%`,
	);
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
				const model = colorText(ctx, runtime.modelId);
				const thinking = colorThinking(ctx, runtime.thinkingLevel);
				const workspaceWidth = Math.max(
					1,
					width - widthOf(`${model} • ${thinking}`) - widthOf(" • "),
				);
				const workspace = buildWorkspaceSummary(ctx, snapshot, workspaceWidth);
				const left = `${workspace} • ${model} • ${thinking}`;
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
