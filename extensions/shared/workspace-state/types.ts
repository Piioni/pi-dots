export interface PullRequestInfo {
  number: number;
  url: string;
  isDraft: boolean;
}

export interface GitStatusSummary {
  conflicted: number;
  ahead: number;
  behind: number;
  untracked: number;
  modified: number;
  staged: number;
  renamed: number;
  deleted: number;
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
  isRepository: boolean;
  branch?: string;
  gitState?: GitStateSummary;
  gitStatus?: GitStatusSummary;
  pullRequest?: PullRequestInfo | null;
}
