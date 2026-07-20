import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

import { WORKING_MESSAGES } from "./messages";
import { pickRandom } from "./random";

function formatElapsed(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return m > 0 ? `${m}m ${s}s` : `${s}s`;
}

const RESET = "\x1b[0m";

// Catppuccin Mocha palette — ANSI-256 approximations
const MOCHA_COLORS: readonly string[] = [
  "\x1b[38;5;219m", // Pink
  "\x1b[38;5;212m", // Flamingo
  "\x1b[38;5;209m", // Peach
  "\x1b[38;5;216m", // Maroon
  "\x1b[38;5;203m", // Red
  "\x1b[38;5;141m", // Mauve
  "\x1b[38;5;140m", // Lavender
  "\x1b[38;5;111m", // Sapphire
  "\x1b[38;5;75m",  // Blue
  "\x1b[38;5;43m",  // Teal
  "\x1b[38;5;78m",  // Green
  "\x1b[38;5;228m", // Yellow
  "\x1b[38;5;222m", // Peach
  "\x1b[38;5;180m", // Rosewater
];

function buildColorWave(text: string, wavePhase: number, color: string): string {
  const len = text.length;
  if (len === 0) return text;

  // Sweep a 3-char highlight cluster across the text
  let result = "";
  for (let i = 0; i < len; i++) {
    const dist = (i - wavePhase + len) % len;
    if (dist < 3) {
      result += `${color}${text[i]}${RESET}`;
    } else {
      result += text[i];
    }
  }
  return result;
}

export default function (pi: ExtensionAPI) {
  let interval: ReturnType<typeof setInterval> | null = null;

  pi.on("agent_start", async (_event, ctx) => {
    const message = pickRandom(WORKING_MESSAGES);
    const color = pickRandom(MOCHA_COLORS);
    const startedAt = Date.now();
    let wavePhase = 0;
    let cachedBase = `${message} (0s)`;
    let lastBaseUpdate = 0;

    const render = () => {
      ctx.ui.setWorkingMessage(buildColorWave(cachedBase, wavePhase % cachedBase.length, color));
    };

    render();

    interval = setInterval(() => {
      wavePhase++;
      const now = Date.now();
      if (now - lastBaseUpdate >= 3000) {
    const elapsed = Math.floor((now - startedAt) / 1000);
    cachedBase = `${message} (${formatElapsed(elapsed)})`;
    lastBaseUpdate = now;
      }
      render();
    }, 120);
  });

  pi.on("agent_end", async () => {
    if (interval !== null) {
      clearInterval(interval);
      interval = null;
    }
  });
}
