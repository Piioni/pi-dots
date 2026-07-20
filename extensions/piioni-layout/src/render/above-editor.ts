import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { colorCwd, colorGit, colorPeach, colorStatus, colorText } from "../colors";
import { truncate } from "../format";
import type { LayoutSnapshot } from "../layout-state";
import { selectResponsiveHeader } from "./responsive";
import type { RenderableTui, WidgetComponent } from "../types";

function buildGitStateText(snapshot: LayoutSnapshot): string {
  const gitState = snapshot.workspace.gitState;
  if (!gitState) return "";

  const progress = gitState.progress?.current && gitState.progress?.total
    ? ` ${gitState.progress.current}/${gitState.progress.total}`
    : "";

  return `${gitState.label}${progress}`;
}

function buildGitStatusText(snapshot: LayoutSnapshot): string {
  const status = snapshot.workspace.gitStatus;
  if (!status) return "";

  const parts: string[] = [];

  if (status.conflicted > 0) parts.push(`${status.conflicted}`);
  if (status.ahead > 0 && status.behind > 0) {
    parts.push(`⇕${status.ahead}/${status.behind}`);
  } else {
    if (status.ahead > 0) parts.push(`⇡${status.ahead}`);
    if (status.behind > 0) parts.push(`⇣${status.behind}`);
  }
  if (status.untracked > 0) parts.push(`?${status.untracked}`);
  if (status.modified > 0) parts.push(`!${status.modified}`);
  if (status.staged > 0) parts.push(`+${status.staged}`);
  if (status.renamed > 0) parts.push(`»${status.renamed}`);
  if (status.deleted > 0) parts.push(`✘${status.deleted}`);

  return parts.join(" ");
}

export function makeAboveEditorWidget(
  ctx: ExtensionContext,
  activeTuis: Set<RenderableTui>,
  tui: RenderableTui,
  getSnapshot: () => LayoutSnapshot,
): WidgetComponent {
  return {
    dispose() {
      activeTuis.delete(tui);
    },
    invalidate() {},
    render(width: number): string[] {
      if (width <= 0) return [];

      const snapshot = getSnapshot();
      const decision = selectResponsiveHeader({
        width,
        cwd: snapshot.cwd,
        branch: snapshot.workspace.branch ? ` ${snapshot.workspace.branch}` : undefined,
        gitState: buildGitStateText(snapshot) || undefined,
        gitStatus: buildGitStatusText(snapshot) || undefined,
      });
      const parts = [colorCwd(ctx, decision.cwd)];

      if (decision.branch || decision.gitState || decision.gitStatus) {
        parts.push(colorText(ctx, "->"));
      }
      if (decision.branch) parts.push(colorGit(ctx, decision.branch));
      if (decision.gitState) parts.push(colorPeach(ctx, decision.gitState));
      if (decision.gitStatus) parts.push(colorStatus(ctx, "warning", decision.gitStatus));

      return [truncate(parts.join(" "), width)];
    },
  };
}
