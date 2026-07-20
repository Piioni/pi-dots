import type { PermissionMode, PermissionModeName, PermissionState } from "./types";

export const READ_ONLY_BASH: Record<string, PermissionState> = {
  "git status*": "allow",
  "git diff*": "allow",
  "git log*": "allow",
  "git branch*": "allow",
  pwd: "allow",
  "ls*": "allow",
  "rg*": "allow",
  "grep*": "allow",
  "find*": "allow",
  "npm ls*": "allow",
  "npm view*": "allow",
  "pi --help": "allow",
  "npx tsc --noEmit": "allow",
};

export const TEST_AND_BUILD_BASH: Record<string, PermissionState> = {
  "npm test*": "allow",
  "npm run test*": "allow",
  "npm run build*": "allow",
  "pnpm test*": "allow",
  "pnpm build*": "allow",
  "bun test*": "allow",
  "go test*": "allow",
  "cargo test*": "allow",
  "dart test*": "allow",
  "flutter test*": "allow",
};

export const GUARDED_BASH: Record<string, PermissionState> = {
  "git commit*": "ask",
  "git push*": "ask",
  "git rebase*": "ask",
  "git reset*": "ask",
  "gh pr*": "ask",
  "gh issue*": "ask",
  "rm*": "ask",
  "mv*": "ask",
  "cp*": "ask",
  "chmod*": "ask",
  "chown*": "ask",
  "sudo*": "ask",
  "docker*": "ask",
  "npm install*": "ask",
  "pnpm install*": "ask",
  "bun install*": "ask",
  "yarn install*": "ask",
};

export const SAFE_TOOLS: Record<string, PermissionState> = {
  read: "allow",
  grep: "allow",
  find: "allow",
  ls: "allow",
  ask_user_question: "allow",
  todo: "allow",
};

export const MODES: PermissionMode[] = [
  {
    name: "Palantír",
    policy: {
      defaultPolicy: { tools: "ask", bash: "ask", mcp: "ask", skills: "allow", special: "ask" },
      tools: { ...SAFE_TOOLS, write: "ask", edit: "ask", task: "ask" },
      bash: { ...READ_ONLY_BASH, ...GUARDED_BASH },
      mcp: {},
      skills: {},
      special: {
        "external_directory:/home/piioni/.pi/agent/**": "allow",
        "external_directory:/home/piioni/.config/**": "allow",
        "external_directory:/home/piioni/Sipos/**": "allow",
        external_directory: "ask",
      },
    },
  },
  {
    name: "Mithril Forge",
    policy: {
      defaultPolicy: { tools: "ask", bash: "ask", mcp: "ask", skills: "allow", special: "ask" },
      tools: { ...SAFE_TOOLS, write: "allow", edit: "allow", task: "ask" },
      bash: { ...READ_ONLY_BASH, ...TEST_AND_BUILD_BASH, ...GUARDED_BASH },
      mcp: {},
      skills: {},
      special: {
        "external_directory:/home/piioni/.pi/agent/**": "allow",
        "external_directory:/home/piioni/.config/**": "allow",
        "external_directory:/home/piioni/Sipos/**": "allow",
        external_directory: "ask",
      },
    },
  },
  {
    name: "Balrog",
    policy: {
      defaultPolicy: { tools: "allow", bash: "allow", mcp: "allow", skills: "allow", special: "allow" },
      tools: {},
      bash: {
        "git push --force*": "ask",
        "git reset --hard*": "ask",
        "git clean*": "ask",
        "rm -rf*": "ask",
        "sudo*": "ask",
        "chmod -R*": "ask",
        "chown -R*": "ask",
        "docker system prune*": "ask",
      },
      mcp: {},
      skills: {},
      special: {},
    },
  },
];

export function isPermissionModeName(mode: string): mode is PermissionModeName {
  return MODES.some((entry) => entry.name === mode);
}

export function getMode(name: string): PermissionMode {
  return MODES.find((mode) => mode.name === name) ?? MODES[0];
}

export function getNextMode(currentName: string): PermissionMode {
  const currentIndex = MODES.findIndex((mode) => mode.name === currentName);
  return MODES[(currentIndex + 1) % MODES.length];
}
