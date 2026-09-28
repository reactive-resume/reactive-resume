import type { TsdownPlugin } from "tsdown";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "tsdown";

const rootPackageJson = JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf-8")) as {
	version?: string;
};

// Lambda disables require(ESM) and uses stricter CJS export detection than standalone Node.
const bundledInteropPackages = new Set([
	"@uiw/color-convert",
	"@babel/runtime",
	"sanitize-html",
	"htmlparser2",
	"domhandler",
	"domutils",
	"domelementtype",
	"dom-serializer",
	"entities",
	"deepmerge",
	"escape-string-regexp",
	"is-plain-object",
	"parse-srcset",
	"postcss",
	"nanoid",
	"picocolors",
	"source-map-js",
	"launder",
	"dayjs",
]);

const shouldExternalizeThirdParty = (id: string) => {
	const packageName = id
		.split("/")
		.slice(0, id.startsWith("@") ? 2 : 1)
		.join("/");
	if (id.startsWith("@reactive-resume/") || bundledInteropPackages.has(packageName)) return false;
	if (id.startsWith("@/") || id.startsWith(".") || id.startsWith("/") || id.startsWith("\0")) return false;

	return true;
};

const aiPromptsDir = resolve(dirname(fileURLToPath(import.meta.url)), "../../packages/ai/src/prompts");

const promptAssetsPlugin: TsdownPlugin = {
	name: "prompt-assets",
	buildStart() {
		for (const filename of readdirSync(aiPromptsDir)) {
			if (!filename.endsWith(".md")) continue;

			this.emitFile({
				type: "asset",
				fileName: `prompts/${filename}`,
				source: readFileSync(resolve(aiPromptsDir, filename), "utf-8"),
			});
		}
	},
};

export default defineConfig({
	entry: { index: "src/index.ts", vercel: "src/vercel.ts", "prepare-deployment": "src/prepare-deployment.ts" },
	// Keep import.meta.url-based asset lookup adjacent to the entrypoints.
	outputOptions: { chunkFileNames: "[name]-[hash].mjs" },
	format: "esm",
	platform: "node",
	target: "node24",
	outDir: "dist",
	clean: true,
	shims: true,
	dts: false,
	define: { __APP_VERSION__: JSON.stringify(rootPackageJson.version ?? "0.0.0") },
	// The flagged dynamic imports are deliberate: they defer evaluation of env-dependent
	// modules so tests can run without env vars, not to split chunks.
	suppressWarnings: [/dynamic import will not move module into another chunk/],
	outExtensions: () => ({ js: ".mjs" }),
	deps: {
		alwaysBundle: [/^@reactive-resume\//, ...bundledInteropPackages],
		neverBundle: shouldExternalizeThirdParty,
	},
	plugins: [promptAssetsPlugin],
});
