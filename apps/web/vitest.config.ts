import { fileURLToPath } from "node:url";
import { lingui } from "@lingui/vite-plugin";
import tailwindcss from "@tailwindcss/vite";
import { mergeConfig } from "vite-plus";
// @boundaries-ignore root shared Vitest config
import { createVitestProjectConfig } from "../../vitest.shared.mts";

export default mergeConfig(
	createVitestProjectConfig({
		name: "web",
		dirname: fileURLToPath(new URL(".", import.meta.url)),
		plugins: [tailwindcss(), lingui({ macroTransform: true })],
	}),
	{ test: { setupFiles: ["./vitest.setup.ts"] } },
);
