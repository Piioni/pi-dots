import { readdirSync, readFileSync, type Dirent } from "node:fs";
import { join, relative } from "node:path";
import { parseFrontmatter } from "./frontmatter.ts";
import type { ClaudeProject } from "./project.ts";

export type ClaudeSkills = { paths: string[]; diagnostics: string[] };

const MAX_DIAGNOSTICS = 20;
const MAX_DIAGNOSTIC_CHARS = 256;
const UNSUPPORTED_SKILL_FIELDS = new Set([
  "allowed-tools", "disallowed-tools", "user-invocable", "model", "context", "agent", "hooks",
]);

export function discoverClaudeSkills(project: ClaudeProject): ClaudeSkills {
  const paths: string[] = [];
  const diagnostics: string[] = [];
  let suppressedDiagnostics = 0;
  const diagnose = (message: string) => {
    if (diagnostics.length < MAX_DIAGNOSTICS - 1) {
      diagnostics.push(message.replace(/[\x00-\x1f\x7f-\x9f]/g, " ").slice(0, MAX_DIAGNOSTIC_CHARS));
    }
    else suppressedDiagnostics++;
  };
  const visit = (dir: string) => {
    let entries: Dirent[];
    try {
      entries = readdirSync(dir, { withFileTypes: true }).sort((a, b) =>
        a.name < b.name ? -1 : a.name > b.name ? 1 : 0,
      );
    } catch {
      diagnose(`Claude skills directory '${relative(project.skillsDir, dir)}' could not be read.`);
      return;
    }

    for (const entry of entries) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) visit(path);
      else if (entry.isFile() && entry.name === "SKILL.md") validate(path, project.skillsDir, paths, diagnose);
    }
  };
  visit(project.skillsDir);
  if (suppressedDiagnostics > 0) diagnostics.push(`${suppressedDiagnostics} additional Claude skill diagnostics suppressed.`);
  return { paths, diagnostics };
}

function validate(path: string, skillsDir: string, paths: string[], diagnose: (message: string) => void): void {
  const pathName = relative(skillsDir, path);
  let content: string;
  try {
    content = readFileSync(path, "utf8");
  } catch {
    diagnose(`Claude skill '${pathName}' could not be read and was not loaded.`);
    return;
  }

  const parsed = parseFrontmatter(content);
  if (parsed.error) {
    diagnose(`Claude skill '${pathName}' has malformed frontmatter and was not loaded.`);
    return;
  }
  const skillName = parsed.metadata.get("name") ?? "";
  const description = parsed.metadata.get("description") ?? "";
  if (
    !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(skillName) ||
    skillName.length > 64 ||
    !description ||
    description.length > 1024
  ) {
    diagnose(`Claude skill '${pathName}' lacks supported name/description metadata and was not loaded.`);
    return;
  }
  const disableInvocation = parsed.metadata.get("disable-model-invocation");
  if (disableInvocation !== undefined && !/^(?:true|false)$/i.test(disableInvocation)) {
    diagnose(`Claude skill '${pathName}' has invalid 'disable-model-invocation' metadata and was not loaded.`);
    return;
  }

  if (parsed.metadata.has("argument-hint")) {
    diagnose(`Claude skill '${pathName}' uses unsupported descriptive field 'argument-hint'; it was loaded without that hint.`);
  }
  const unsupported = [...UNSUPPORTED_SKILL_FIELDS].filter((field) => parsed.metadata.has(field));
  if (unsupported.length > 0) {
    diagnose(`Claude skill '${pathName}' uses unsupported Claude fields ${unsupported.map((field) => `'${field}'`).join(", ")}; it was not loaded to avoid ignoring its restrictions or execution behavior.`);
    return;
  }
  paths.push(path);
}
