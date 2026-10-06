import { Marked } from "/home/piioni/.local/lib/node_modules/@earendil-works/pi-coding-agent/node_modules/@earendil-works/pi-tui/dist/index.js";

const marked = new Marked();

/** The exact Marked implementation exported by the installed Pi TUI package. */
export function lexWithInstalledMarked(source: string) {
  return marked.lexer(source);
}
