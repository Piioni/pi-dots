import { readFileSync, readdirSync, statSync, type Dirent } from "node:fs";
import { basename, join, relative } from "node:path";
import { MAX_RULE_BYTES } from "./config.ts";
import { parseFrontmatter } from "./frontmatter.ts";
import type { ClaudeProject } from "./project.ts";

export function injectClaudeRules(systemPrompt: string, rules: string): string {
  if (systemPrompt.includes(rules)) return systemPrompt;
  return `${systemPrompt}\n\n${rules}`;
}

export type ClaudeRules = { content?: string; diagnostics: string[] };

const MAX_DIAGNOSTICS = 20;
const MAX_DIAGNOSTIC_BYTES = 256;

function safeDiagnostic(message: string): string {
  let result = "";
  for (const character of message.replace(/[\x00-\x1f\x7f-\x9f]/g, " ")) {
    if (Buffer.byteLength(result + character) > MAX_DIAGNOSTIC_BYTES) break;
    result += character;
  }
  return result;
}

export function readClaudeRules(project: ClaudeProject): ClaudeRules {
  const files: string[] = [];
  const diagnostics: string[] = [];
  let suppressedDiagnostics = 0;
  const diagnose = (message: string) => {
    if (diagnostics.length < MAX_DIAGNOSTICS - 1) diagnostics.push(safeDiagnostic(message));
    else suppressedDiagnostics++;
  };
  const collect = (dir: string) => {
    let entries: Dirent[];
    try {
      entries = readdirSync(dir, { withFileTypes: true }).sort((a, b) =>
        a.name < b.name ? -1 : a.name > b.name ? 1 : 0,
      );
    } catch {
      diagnose(`Claude rules directory '${relative(project.rulesDir, dir)}' could not be read.`);
      return;
    }
    for (const entry of entries) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) collect(path);
      else if (entry.isFile() && entry.name.endsWith(".md")) files.push(path);
    }
  };
  try {
    if (statSync(project.rulesDir).isDirectory()) collect(project.rulesDir);
  } catch (error) {
    if (!(typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT")) {
      diagnose("Claude rules directory could not be read.");
    }
  }
  files.sort((a, b) => a < b ? -1 : a > b ? 1 : 0);

  const header = [
    "# Imported Claude Project Rules",
    "",
    "The following rules were imported read-only from the nearest `.claude/rules` directory by the Pi Claude project adapter.",
    "Treat them as project conventions. Do not edit generated `sipos-*` Claude assets unless explicitly instructed.",
    "",
  ];
  const sections: string[] = [];
  const render = (items: string[]) => [...header, ...items].join("\n");
  for (const file of files) {
    try {
      if (statSync(file).size > MAX_RULE_BYTES) {
        diagnose(`Claude rule '${relative(project.rulesDir, file)}' exceeds the ${MAX_RULE_BYTES}-byte adapter limit and was skipped.`);
        continue;
      }
      const content = readFileSync(file, "utf8");
      const parsed = parseFrontmatter(content);
      if (parsed.error) {
        diagnose(`Claude rule '${relative(project.rulesDir, file)}' has malformed frontmatter and was not loaded.`);
        continue;
      }
      if (parsed.metadata.has("paths")) {
        diagnose(`Claude rule '${relative(project.rulesDir, file)}' is path-scoped and was skipped because Pi has no safe native path-rule lifecycle.`);
        continue;
      }

      const section = `## ${basename(file)}\n\n${parsed.body.trim()}`;
      if (Buffer.byteLength(render([...sections, section]), "utf8") > MAX_RULE_BYTES) {
        diagnose(`Claude rule '${relative(project.rulesDir, file)}' would exceed the ${MAX_RULE_BYTES}-byte imported rules limit and was skipped.`);
        continue;
      }
      sections.push(section);
    } catch {
      diagnose(`Claude rule '${relative(project.rulesDir, file)}' could not be read and was not loaded.`);
    }
  }
  if (suppressedDiagnostics > 0) diagnostics.push(`${suppressedDiagnostics} additional Claude rule diagnostics suppressed.`);
  return sections.length === 0 ? { diagnostics } : { content: render(sections), diagnostics };
}
