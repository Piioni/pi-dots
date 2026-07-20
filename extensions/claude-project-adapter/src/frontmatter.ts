export function stripFrontmatter(content: string): string {
  if (!content.startsWith("---")) return content;

  const end = content.indexOf("\n---", 3);
  if (end === -1) return content;

  return content.slice(end + 4).trimStart();
}

export function readFrontmatterDescription(content: string): string | undefined {
  if (!content.startsWith("---")) return undefined;

  const end = content.indexOf("\n---", 3);
  if (end === -1) return undefined;

  const frontmatter = content.slice(3, end);
  const match = frontmatter.match(/^description:\s*(.+)$/m);
  return match?.[1]?.trim().replace(/^[']|[']$/g, "").replace(/^[\"]|[\"]$/g, "");
}
