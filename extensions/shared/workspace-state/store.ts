import { getGitBranchFromCwd, getGitStateFromCwd, getGitStatusFromCwd } from "./git";
import { getOpenPullRequestForBranch } from "./github";
import type { WorkspaceStateSnapshot } from "./types";

export interface WorkspaceStateStore {
  getSnapshot(): WorkspaceStateSnapshot;
  refresh(cwd: string): Promise<void>;
  subscribe(listener: (snapshot: WorkspaceStateSnapshot) => void): () => void;
}

function snapshotsEqual(a: WorkspaceStateSnapshot, b: WorkspaceStateSnapshot): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

export function createWorkspaceStateStore(): WorkspaceStateStore {
  let snapshot: WorkspaceStateSnapshot = { isRepository: false };
  let generation = 0;
  let inFlight: Promise<void> | undefined;
  let pendingCwd: string | undefined;
  const listeners = new Set<(snapshot: WorkspaceStateSnapshot) => void>();

  const publish = () => {
    for (const listener of listeners) listener(snapshot);
  };

  const setSnapshot = (next: WorkspaceStateSnapshot) => {
    if (snapshotsEqual(snapshot, next)) return;
    snapshot = next;
    publish();
  };

  return {
    getSnapshot: () => snapshot,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    async refresh(cwd: string) {
      if (inFlight && pendingCwd === cwd) {
        await inFlight;
        return;
      }

      pendingCwd = cwd;
      const run = async () => {
        const runGeneration = ++generation;
        const branch = getGitBranchFromCwd(cwd);

        if (!branch) {
          setSnapshot({ cwd, isRepository: false, branch: undefined, gitState: undefined, gitStatus: undefined, pullRequest: null });
          return;
        }

        const gitState = getGitStateFromCwd(cwd);
        const gitStatus = await getGitStatusFromCwd(cwd);
        if (runGeneration !== generation) return;

        setSnapshot({
          cwd,
          isRepository: true,
          branch,
          gitState,
          gitStatus,
          pullRequest: snapshot.branch === branch ? snapshot.pullRequest ?? null : null,
        });

        if (branch === "detached") {
          setSnapshot({ cwd, isRepository: true, branch, gitState, gitStatus, pullRequest: null });
          return;
        }

        const pullRequest = await getOpenPullRequestForBranch(cwd, branch);
        if (runGeneration !== generation) return;

        setSnapshot({ cwd, isRepository: true, branch, gitState, gitStatus, pullRequest });
      };

      const pending = run().finally(() => {
        if (inFlight === pending) {
          inFlight = undefined;
          pendingCwd = undefined;
        }
      });
      inFlight = pending;
      await pending;
    },
  };
}
