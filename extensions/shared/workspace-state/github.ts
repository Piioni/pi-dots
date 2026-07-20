import { execFile } from "node:child_process";
import type { PullRequestInfo } from "./types";

const GH_TIMEOUT_MS = 10_000;

function parsePullRequest(value: unknown): PullRequestInfo | null {
  if (typeof value !== "object" || value === null) return null;
  if (!("number" in value) || typeof value.number !== "number") return null;
  if (!("url" in value) || typeof value.url !== "string") return null;
  if (!("state" in value) || value.state !== "OPEN") return null;

  return {
    number: value.number,
    url: value.url,
    isDraft: "isDraft" in value && value.isDraft === true,
  };
}

export async function getOpenPullRequestForBranch(
  cwd: string,
  branch: string,
): Promise<PullRequestInfo | null> {
  return new Promise((resolve) => {
    execFile(
      "gh",
      ["pr", "view", branch, "--json", "number,url,state,isDraft"],
      { cwd, timeout: GH_TIMEOUT_MS },
      (error, stdout) => {
        if (error) {
          resolve(null);
          return;
        }

        try {
          resolve(parsePullRequest(JSON.parse(stdout)));
        } catch {
          resolve(null);
        }
      },
    );
  });
}
