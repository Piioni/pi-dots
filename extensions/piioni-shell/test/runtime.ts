import { createRequire, registerHooks } from "node:module";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const packageRoot = "/home/piioni/.local/lib/node_modules/@earendil-works/pi-coding-agent";
const codingAgentEntry = `${packageRoot}/dist/index.js`;
const tuiEntry = `${packageRoot}/node_modules/@earendil-works/pi-tui/dist/index.js`;
const require = createRequire(import.meta.url);
const typescript = require("/home/piioni/.pi/agent/extensions/ui-overhaul/node_modules/typescript/lib/typescript.js");

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "@earendil-works/pi-coding-agent") return { url: `file://${codingAgentEntry}`, shortCircuit: true };
    if (specifier === "@earendil-works/pi-tui") return { url: `file://${tuiEntry}`, shortCircuit: true };
    return nextResolve(specifier, context);
  },
  load(url, context, nextLoad) {
    if (url.startsWith("file:") && url.endsWith(".ts")) {
      const source = readFileSync(fileURLToPath(url), "utf8");
      const output = typescript.transpileModule(source, {
        compilerOptions: { module: typescript.ModuleKind.ESNext, target: typescript.ScriptTarget.ES2022, verbatimModuleSyntax: true },
      }).outputText;
      return { format: "module", source: output, shortCircuit: true };
    }
    return nextLoad(url, context);
  },
});
