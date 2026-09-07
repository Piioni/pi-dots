import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

import { WORKING_MESSAGES } from "./messages";
import { pickRandom } from "./random";

function formatElapsed(seconds: number): string {
	const m = Math.floor(seconds / 60);
	const s = seconds % 60;
	return m > 0 ? `${m}m ${s}s` : `${s}s`;
}

const RESET = "\x1b[0m";

// Official Catppuccin Mocha accent palette using truecolor ANSI sequences.
const MOCHA_COLORS: readonly string[] = [
	"\x1b[38;2;245;224;220m", // Rosewater #f5e0dc
	"\x1b[38;2;242;205;205m", // Flamingo #f2cdcd
	"\x1b[38;2;245;194;231m", // Pink #f5c2e7
	"\x1b[38;2;203;166;247m", // Mauve #cba6f7
	"\x1b[38;2;243;139;168m", // Red #f38ba8
	"\x1b[38;2;235;160;172m", // Maroon #eba0ac
	"\x1b[38;2;250;179;135m", // Peach #fab387
	"\x1b[38;2;249;226;175m", // Yellow #f9e2af
	"\x1b[38;2;166;227;161m", // Green #a6e3a1
	"\x1b[38;2;148;226;213m", // Teal #94e2d5
	"\x1b[38;2;137;220;235m", // Sky #89dceb
	"\x1b[38;2;116;199;236m", // Sapphire #74c7ec
	"\x1b[38;2;137;180;250m", // Blue #89b4fa
	"\x1b[38;2;180;190;254m", // Lavender #b4befe
];

function pickHighlightColor(baseColor: string): string {
	const highlightColors = MOCHA_COLORS.filter((color) => color !== baseColor);
	return pickRandom(highlightColors);
}

function buildColorWave(
	text: string,
	wavePhase: number,
	baseColor: string,
	highlightColor: string,
): string {
	const len = text.length;
	if (len === 0) return text;

	// Render the full message with a stable base color, then sweep a highlight over it.
	let result = "";
	for (let i = 0; i < len; i++) {
		const dist = (i - wavePhase + len) % len;
		const color = dist < 3 ? highlightColor : baseColor;
		result += `${color}${text[i]}${RESET}`;
	}
	return result;
}

export default function (pi: ExtensionAPI) {
	let interval: ReturnType<typeof setInterval> | null = null;

		const stopAnimation = () => {
			if (interval === null) return;
			clearInterval(interval);
			interval = null;
		};

	pi.on("agent_start", async (_event, ctx) => {
		const message = pickRandom(WORKING_MESSAGES);
		const baseColor = pickRandom(MOCHA_COLORS);
		const highlightColor = pickHighlightColor(baseColor);
		const startedAt = Date.now();
		let wavePhase = 0;
		let cachedBase = `${message} (0s)`;
		let lastBaseUpdate = 0;

		const render = () => {
			ctx.ui.setWorkingMessage(
				buildColorWave(
					cachedBase,
					wavePhase % cachedBase.length,
					baseColor,
					highlightColor,
				),
			);
		};

		render();

		stopAnimation();

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
		stopAnimation();
	});

	pi.on("session_shutdown", async () => {
		stopAnimation();
	});
}
