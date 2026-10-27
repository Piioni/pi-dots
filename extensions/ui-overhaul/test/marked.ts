import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const piRequire = createRequire(require.resolve("../../pi-tool-display/node_modules/@earendil-works/pi-coding-agent/package.json"));
const { Marked } = piRequire("@earendil-works/pi-tui") as typeof import("@earendil-works/pi-tui");
const marked = new Marked();

/** The exact Marked implementation exported by the installed Pi TUI package. */
export function lexWithInstalledMarked(source: string) {
  return marked.lexer(source);
}
