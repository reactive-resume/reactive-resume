import type { ProxyOptions } from "vite";
import { readFileSync } from "node:fs";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import { lingui } from "@lingui/vite-plugin";
import babel from "@rolldown/plugin-babel";
import tailwindcss from "@tailwindcss/vite";
import { devtools } from "@tanstack/devtools-vite";
import { tanstackRouter } from "@tanstack/router-plugin/vite";
import viteReact, { reactCompilerPreset } from "@vitejs/plugin-react";
import { defineConfig } from "vite";

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

	await rm(prerenderOutDir, { recursive: true, force: true });

	for (const name of prerenderedPages) {
		await mkdir(`${prerenderOutDir}/${name}`, { recursive: true });

		for (const locale of locales) {
			const page = await renderPage(name, locale);
			const html = shell
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

// TanStack Router loads `route.tsx?tsr-split=…`. The native parser infers syntax from the filename,
// and the query hides `.tsx`, so JSX is parsed as JS.
const linguiPlugin = () =>
	lingui({ macroTransform: { parser: { syntax: "typescript", tsx: true, decorators: true } } });

const serverPaths = ["/api", "/mcp", "/uploads", "/.well-known", "/schema.json"] as const;

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

	// `vite build` builds the app, then the marketing pages' server entry, then prerenders the pages with it.
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
