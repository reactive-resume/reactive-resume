import { cp, mkdir, readdir, rm } from "node:fs/promises";
import { builtinModules, createRequire } from "node:module";
import { resolve } from "node:path";
import { build } from "esbuild";

const root = resolve(import.meta.dirname, "../..");
const output = resolve(root, "apps/server/dist-cloudflare");
const require = createRequire(resolve(root, "apps/server/package.json"));
await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });
await build({
	absWorkingDir: root,
	entryPoints: ["apps/server/src/cloudflare/index.ts"],
	outfile: `${output}/index.js`,
	bundle: true,
	format: "esm",
	platform: "neutral",
	mainFields: ["browser", "module", "main"],
	conditions: ["workerd", "worker", "browser"],
	target: "es2022",
	minify: true,
	external: ["node:*", "cloudflare:*", ...builtinModules],
	banner: {
		js: 'import { createRequire } from "node:module"; const require = createRequire("file:///bundle/index.js");',
	},
	alias: {
		sharp: "./apps/server/src/cloudflare/sharp.ts",
	},
	define: {
		__APP_VERSION__: JSON.stringify(require("../../package.json").version),
		"import.meta.url": JSON.stringify("file:///bundle/index.js"),
	},
	plugins: [
		{
			name: "forme-wasm",
			setup(builder) {
				builder.onResolve({ filter: /^css-tree$/ }, () => ({ path: require.resolve("css-tree/dist/csstree.esm") }));
				builder.onResolve({ filter: /\.wasm$/ }, () => ({ path: "./forme.wasm", external: true }));
			},
		},
	],
});
await cp(require.resolve("@formepdf/core/pkg-web/forme_bg.wasm"), `${output}/forme.wasm`);
await mkdir(`${output}/prompts`);
for (const name of await readdir(resolve(root, "packages/ai/src/prompts"))) {
	if (name.endsWith(".md")) await cp(resolve(root, "packages/ai/src/prompts", name), `${output}/prompts/${name}`);
}
await cp(resolve(root, "apps/web/dist"), `${output}/assets`, { recursive: true });
await cp(resolve(root, "apps/web/dist-prerender"), `${output}/assets/_prerender`, { recursive: true });
