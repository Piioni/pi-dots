export type ParsedFrontmatter = {
  body: string;
  metadata: Map<string, string>;
  error?: string;
};

export function parseFrontmatter(content: string): ParsedFrontmatter {
  const opening = content.startsWith("---\n") ? 4 : content.startsWith("---\r\n") ? 5 : 0;
  if (!opening) return { body: content, metadata: new Map() };

  const rest = content.slice(opening);
  const closing = /^(?:---|\.\.\.)\s*$/m.exec(rest);
  if (!closing) return { body: "", metadata: new Map(), error: "frontmatter is not terminated" };

  const source = rest.slice(0, closing.index);
  const body = rest.slice(closing.index + closing[0].length).replace(/^\r?\n/, "");
  const metadata = new Map<string, string>();
  for (const line of source.split(/\r?\n/)) {
    if (!line.trim() || line.trimStart().startsWith("#") || /^\s/.test(line)) continue;
    const match = line.match(/^([A-Za-z0-9_-]+):(?:\s*(.*))?$/);
    if (!match) return { body: "", metadata: new Map(), error: "frontmatter is malformed" };
    let value = (match[2] ?? "").trim();
    if (value.startsWith("'") && value.endsWith("'")) value = value.slice(1, -1).replaceAll("''", "'");
    else if (value.startsWith('"') && value.endsWith('"')) {
      try {
        value = JSON.parse(value);
      } catch {
        return { body: "", metadata: new Map(), error: "frontmatter is malformed" };
      }
    }
    metadata.set(match[1], value);
  }
  return { body, metadata };
}

export function readFrontmatterDescription(content: string): string | undefined {
  const parsed = parseFrontmatter(content);
  const description = parsed.metadata.get("description");
  return description || undefined;
}
