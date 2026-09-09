export interface PullRequestInfo {
  number: number;
  url: string;
  isDraft: boolean;
}

export interface GitStateProgress {
  current?: number;
  total?: number;
}

export interface GitStateSummary {
  label: string;
  progress?: GitStateProgress;
}

export interface WorkspaceStateSnapshot {
  cwd?: string;
  branch?: string;
  gitState?: GitStateSummary;
  pullRequest?: PullRequestInfo | null;
}
