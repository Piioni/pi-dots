export interface WorkspaceRefreshScheduler {
  request(cwd: string): Promise<void>;
  hasNewerRequest(): boolean;
  shutdown(): void;
}

export function createWorkspaceRefreshScheduler(
  refresh: (cwd: string) => Promise<void>,
  debounceMs = 75,
): WorkspaceRefreshScheduler {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let pendingCwd: string | undefined;
  let requestedGeneration = 0;
  let activeGeneration = 0;
  let running = false;
  let stopped = false;
  let waiters: Array<() => void> = [];

  const resolveWaiters = () => {
    const currentWaiters = waiters;
    waiters = [];
    for (const resolve of currentWaiters) resolve();
  };

  const schedule = () => {
    if (timer || stopped) return;
    timer = setTimeout(() => {
      timer = undefined;
      void run();
    }, debounceMs);
  };

  const run = async () => {
    if (running || stopped || !pendingCwd) return;

    const cwd = pendingCwd;
    pendingCwd = undefined;
    activeGeneration = requestedGeneration;
    running = true;

    try {
      await refresh(cwd);
    } catch {
      // Workspace details are optional UI data. A failed refresh must not affect Pi.
    } finally {
      running = false;
      if (pendingCwd) {
        schedule();
      } else {
        resolveWaiters();
      }
    }
  };

  return {
    request(cwd) {
      if (stopped) return Promise.resolve();

      pendingCwd = cwd;
      requestedGeneration += 1;
      if (timer) clearTimeout(timer);
      timer = undefined;
      schedule();

      return new Promise((resolve) => waiters.push(resolve));
    },

    hasNewerRequest() {
      return running && requestedGeneration > activeGeneration;
    },

    shutdown() {
      stopped = true;
      if (timer) clearTimeout(timer);
      timer = undefined;
      pendingCwd = undefined;
      resolveWaiters();
    },
  };
}
