import { fileURLToPath } from "node:url";
// @boundaries-ignore root shared Vitest config
import { createVitestProjectConfig } from "../../vitest.shared.mts";

const config = createVitestProjectConfig({
	name: "@reactive-resume/pdf",
	dirname: fileURLToPath(new URL(".", import.meta.url)),
});

export default {
	...config,
	// Rendering and rasterizing real PDFs is far slower than Vitest's 5s default: the all-template
	// date characterization renders every template in one test, and the picture-fit override case
	// rasterizes twice. Both land within a second or two of the default on a CI runner.
	test: { ...config.test, testTimeout: 30_000 },
	oxc: { jsx: { runtime: "automatic" as const } },
};
