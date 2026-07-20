import { readFileSync } from "node:fs";
import { basename } from "node:path";
import { MAX_RULE_BYTES } from "./config";
import type { ClaudeProject } from "./project";
import { listMarkdownFiles } from "./project";

export function readClaudeRules(project: ClaudeProject): string | undefined {
  const files = listMarkdownFiles(project.rulesDir);
  if (files.length === 0) return undefined;

  let usedBytes = 0;
  const sections: string[] = [];

  for (const file of files) {
    const content = readFileSync(file, "utf8");
    const bytes = Buffer.byteLength(content, "utf8");

    if (usedBytes + bytes > MAX_RULE_BYTES) {
      sections.push(
        `## ${basename(file)}\n\n[Skipped: Claude rules exceeded ${MAX_RULE_BYTES} bytes adapter limit.]`,
      );
      break;
    }

    usedBytes += bytes;
    sections.push(`## ${basename(file)}\n\n${content.trim()}`);
  }

  return [
    "# Imported Claude Project Rules",
    "",
    "The following rules were imported read-only from the nearest `.claude/rules` directory by the Pi Claude project adapter.",
    "Treat them as project conventions. Do not edit generated `sipos-*` Claude assets unless explicitly instructed.",
    "",
    ...sections,
  ].join("\n");
}
