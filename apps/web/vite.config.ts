import type { Plugin, ProxyOptions } from "vite-plus";
import { readFileSync } from "node:fs";
import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import { lingui } from "@lingui/vite-plugin";
import babel from "@rolldown/plugin-babel";
import tailwindcss from "@tailwindcss/vite";
import { devtools } from "@tanstack/devtools-vite";
import { tanstackRouter } from "@tanstack/router-plugin/vite";
import viteReact, { reactCompilerPreset } from "@vitejs/plugin-react";
import { defineConfig } from "vite-plus";

const rootPackageJsonPath = new URL("../../package.json", import.meta.url);
const rootPackageJson = JSON.parse(readFileSync(rootPackageJsonPath, "utf-8")) as { version: string | undefined };
const appVersion = JSON.stringify(rootPackageJson.version ?? "0.0.0");
const workspaceRoot = fileURLToPath(new URL("../..", import.meta.url));

const webRoot = fileURLToPath(new URL(".", import.meta.url));
const prerenderBundleDir = `${webRoot}node_modules/.prerender`;
// Outside dist/, so the static server and the CDN never serve these pages at their own addresses.
const prerenderOutDir = `${webRoot}dist-prerender`;

const escapeHtml = (value: string) =>
	value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");

/**
 * Writes dist-prerender/<page>/<locale>.html: the built index.html with the page rendered into #app, in that locale's
 * language, direction, title and description. The server sends them for "/" and "/ats-checker"
 * (apps/server/src/static/web.ts).
 */
async function prerenderPages() {
	type PrerenderModule = typeof import("./src/features/homepage/prerender");
	const { locales, prerenderedPages, renderPage }: PrerenderModule = await import(
		pathToFileURL(`${prerenderBundleDir}/prerender.js`).href
	);
	const shell = await readFile(`${webRoot}dist/index.html`, "utf8");
	const assets = await readdir(`${webRoot}dist/assets`);
	// These fonts paint the first screen. Discover the build's hashed URLs before CSS would request them.
	const fontPreloads = ["figtree-latin-wght-normal-", "instrument-serif-latin-400-normal-"]
		.map((prefix) => {
			const asset = assets.find((name) => name.startsWith(prefix) && name.endsWith(".woff2"));
			if (!asset) throw new Error(`Missing marketing font: ${prefix}`);
			return `<link rel="preload" as="font" type="font/woff2" href="/assets/${asset}" crossorigin>`;
		})
		.join("");

	await rm(prerenderOutDir, { recursive: true, force: true });

	for (const name of prerenderedPages) {
		await mkdir(`${prerenderOutDir}/${name}`, { recursive: true });

		for (const locale of locales) {
			const page = await renderPage(name, locale);
			const html = shell
				.replace("</head>", `${fontPreloads}</head>`)
				.replace(/<html lang="[^"]*">/, () => `<html lang="${locale}" dir="${page.dir}">`)
				.replace(/<title>[^<]*<\/title>/, () => `<title>${escapeHtml(page.title)}</title>`)
				.replace(
					/<meta\s+name="description"[^>]*>/,
					() => `<meta name="description" content="${escapeHtml(page.description)}">`,
				)
				.replace('<div id="app"></div>', () => `<div id="app">${page.html}</div>`)
				// The page is readable before any script runs, so the stylesheet, fonts and images go first.
				.replaceAll('<link rel="modulepreload" ', '<link rel="modulepreload" fetchpriority="low" ')
				.replace('<script type="module" ', '<script type="module" fetchpriority="low" ');
			await writeFile(`${prerenderOutDir}/${name}/${locale}.html`, html);
		}
	}
}

// Each Phosphor icon module carries all six weights, and every page loads the ~165 icons of the Icon registry
// (packages/ui/src/components/icon.tsx). The app renders only regular (the default, also set by IconContext) and
// fill, so the other four are cut from the source. A new weight must be added to `keptWeights`.
const keptWeights = new Set(["regular", "fill"]);
const phosphorWeightsPlugin = (): Plugin => ({
	name: "phosphor-weights",
	transform: {
		filter: { id: /@phosphor-icons[\\/]react[\\/]dist[\\/]defs[\\/]/ },
		handler(code, id) {
			// Entries look like `\n  [\n    "bold",\n    …\n  ]`; their content is indented deeper.
			const kept = new Set<string>();
			const result = code.replaceAll(/\n {2}\[\n {4}"(\w+)",[\s\S]*?\n {2}\],?/g, (entry, weight: string) => {
				if (!keptWeights.has(weight)) return "";
				kept.add(weight);
				return entry;
			});
			if (kept.size !== keptWeights.size || result.length === code.length)
				throw new Error(`Unexpected Phosphor icon format in ${id}; update phosphorWeightsPlugin`);
			return { code: result, map: null };
		},
	},
});

// TanStack Router loads `route.tsx?tsr-split=…`. The native parser infers syntax from the filename,
// and the query hides `.tsx`, so JSX is parsed as JS.
const linguiPlugin = () =>
	lingui({ macroTransform: { parser: { syntax: "typescript", tsx: true, decorators: true } } });

const serverPaths = [
	"/api",
	"/mcp",
	"/uploads",
	"/.well-known",
	"/schema.json",
	"/openapi.json",
	"/cards",
	// A resume's web page, `/<username>/<slug>`, is rendered by the server: any two-segment address outside the app's
	// own sections, without a file extension.
	"^/(?!(?:auth|dashboard|builder|agent|templates|ats-checker|resume-templates|assets|src|node_modules|@[a-z-]+)(?:/|$))[^/.]+/[^/.]+/?(?:\\?.*)?$",
] as const;

const serverProxy = serverPaths.reduce(
	(acc, path) => {
		acc[path] = {
			target: `http://localhost:${process.env.SERVER_PORT ?? "3001"}`,
			changeOrigin: true,
		};
		return acc;
	},
	{} as Record<string, ProxyOptions>,
);

export default defineConfig({
	envDir: workspaceRoot,

	resolve: {
		tsconfigPaths: true,
	},

	define: {
		__APP_VERSION__: appVersion,
	},

	// `vp build` builds the app, then the marketing pages' server entry, then prerenders the pages with it.
	builder: {
		buildApp: async (builder) => {
			const { client, ssr } = builder.environments;
			if (!client || !ssr) throw new Error("Missing client or SSR build environment");
			await builder.build(client);
			await builder.build(ssr);
			await prerenderPages();
		},
	},

	environments: {
		ssr: {
			build: {
				outDir: prerenderBundleDir,
				emptyOutDir: true,
				rolldownOptions: { input: "src/features/homepage/prerender.tsx" },
			},
		},
	},

	build: {
		chunkSizeWarningLimit: 10 * 1024, // 10 MB
		rolldownOptions: {
			external: ["bcryptjs", "sharp", "@aws-sdk/client-s3", "ioredis", "linkedom"],
			// Every page loads the libraries the entry imports statically, so they ship as two files instead of ~80:
			// React, the router, Query and Lingui, which rarely change and stay cached across deploys, and the rest.
			// Libraries only lazy routes import split by the import graph. App modules stay split to keep their
			// execution order.
			output: {
				codeSplitting: {
					groups: [
						{
							name: "framework",
							test: /[\\/]node_modules[\\/](?:react|react-dom|scheduler|use-sync-external-store|@tanstack[\\/](?:history|store|react-store|router-core|react-router|query-core|react-query)|@lingui[\\/](?:core|react))[\\/]/,
							tags: ["$initial"],
							priority: 1,
						},
						{ name: "vendor", test: /[\\/]node_modules[\\/]/, tags: ["$initial"] },
					],
				},
			},
		},
	},

	// The PDF worker renders templates with translated section titles, so it needs the catalogs and macros too.
	worker: {
		format: "es",
		plugins: () => [linguiPlugin()],
	},

	server: {
		host: true,
		strictPort: true,
		port: Number.parseInt(process.env.PORT ?? "3000", 10),
		proxy: serverProxy,
	},

	plugins: [
		phosphorWeightsPlugin(),
		{
			name: "cloudflare-rocket-loader-bootstrap",
			transformIndexHtml: {
				order: "post",
				handler: (html) =>
					html.replace(
						/<script\b(?=[^>]*\btype="module")(?=[^>]*\bsrc="\/assets\/[^"]+")(?![^>]*\bdata-cfasync=)[^>]*>/,
						(script) => script.replace('src="', 'data-cfasync="false" src="'),
					),
			},
		},
		devtools(),
		tailwindcss(),
		tanstackRouter({
			target: "react",
			semicolons: true,
			quoteStyle: "double",
			autoCodeSplitting: true,
		}),
		viteReact(),
		linguiPlugin(),
		// Keep @babel/core on 7: under Babel 8, React Compiler 1.0 skips every function with a destructuring default
		// (guarded by src/react-compiler.test.ts).
		babel({ presets: [reactCompilerPreset()] }),
	],
});
