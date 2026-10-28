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
import { RESERVED_SEGMENTS } from "@reactive-resume/utils/app-paths";

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

	// The page is readable before any script runs, so the app's JavaScript starts after the first contentful paint: the
	// stylesheet, fonts and images get the bandwidth first, and lab tools stop counting the scripts toward that paint.
	// The module preloads move into the same moment, so the entry's imports still download in parallel.
	const entry = /<script type="module"[^>]*\ssrc="([^"]+)"[^>]*><\/script>\s*/.exec(shell);
	if (!entry?.[1]) throw new Error("Missing the app's entry script in index.html");
	const modulePreloads = [...shell.matchAll(/<link rel="modulepreload"[^>]*\shref="([^"]+)"[^>]*>\s*/g)];
	const loadApp = `<script data-cfasync="false">(() => {
	let started = false;
	const start = () => {
		if (started) return;
		started = true;
		for (const href of ${JSON.stringify(modulePreloads.map(([, href]) => href))})
			document.head.append(Object.assign(document.createElement("link"), { rel: "modulepreload", href, crossOrigin: "" }));
		import(${JSON.stringify(entry[1])});
	};
	try {
		new PerformanceObserver((list) => {
			if (list.getEntriesByName("first-contentful-paint").length) setTimeout(start);
		}).observe({ type: "paint", buffered: true });
	} catch {
		start();
	}
	// A browser that reports no paint, or a tab opened in the background, starts anyway.
	setTimeout(start, 3000);
})();</script>`;
	const pageShell = modulePreloads
		.reduce((html, [tag]) => html.replace(tag, ""), shell.replace(entry[0], ""))
		.replace("</body>", () => `${loadApp}</body>`);

	await rm(prerenderOutDir, { recursive: true, force: true });

	for (const name of prerenderedPages) {
		await mkdir(`${prerenderOutDir}/${name}`, { recursive: true });

		for (const locale of locales) {
			const page = await renderPage(name, locale);
			const html = pageShell
				.replace("</head>", `${fontPreloads}</head>`)
				.replace(/<html lang="[^"]*">/, () => `<html lang="${locale}" dir="${page.dir}">`)
				.replace(/<title>[^<]*<\/title>/, () => `<title>${escapeHtml(page.title)}</title>`)
				.replace(
					/<meta\s+name="description"[^>]*>/,
					() => `<meta name="description" content="${escapeHtml(page.description)}">`,
				)
				.replace('<div id="app"></div>', () => `<div id="app">${page.html}</div>`);
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

// First path segments that are never a username: the app's own, plus Vite's in development. `.well-known` needs its dot
// escaped; the lookahead takes regex fragments.
const ownSegments = [
	...RESERVED_SEGMENTS.map((segment) => segment.replaceAll(".", "\\.")),
	"assets",
	"src",
	"node_modules",
	"@[a-z-]+",
	"__[^/]*",
].join("|");

const serverPaths = [
	"/api",
	"/mcp",
	"/uploads",
	"/.well-known",
	"/schema.json",
	"/openapi.json",
	"/cards",
	// A resume's web page, `/<username>` (the primary resume) or `/<username>/<slug>`, is rendered by the server: any
	// one- or two-segment address outside the app's own sections, without a file extension.
	`^/(?!(?:${ownSegments})(?:/|$))[^/.]+(?:/[^/.]+)?/?(?:\\?.*)?$`,
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
