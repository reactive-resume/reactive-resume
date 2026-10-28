import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

const mocks = vi.hoisted(() => ({
	env: { APP_URL: "https://rxresu.me" },
	serveStatic: vi.fn(() => vi.fn()),
}));

vi.mock("node:fs", () => ({
	existsSync: vi.fn(() => true),
}));

vi.mock("node:fs/promises", () => ({
	default: {
		readFile: vi.fn(),
	},
}));

vi.mock("@hono/node-server/serve-static", () => ({
	serveStatic: mocks.serveStatic,
}));

vi.mock("@reactive-resume/env/server", () => ({
	env: mocks.env,
}));

const { handleWebApp } = await import("./web");

const searchLink =
	'<https://context7.com/api/v2/ask?siteKey=ask_b3fd9335a63f1b21b1a814ac>; rel="search"; type="text/plain"; title="Search rxresu.me"';

describe("web app fallback classification", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		vi.mocked(fs.readFile).mockResolvedValue("<html>app</html>");
	});

	it.each(["/", "/?locale=de-DE", "/ats-checker", "/resume-templates", "/dashboard", "/index.html"])(
		"advertises Context7 Ask in server-rendered %s and its HEAD response",
		async (path) => {
			vi.mocked(fs.readFile).mockResolvedValue('<html><head></head><body><div id="app"></div></body></html>');
			const response = await handleWebApp(new Request(`https://rxresu.me${path}`));
			const html = await response.text();
			expect(html).toContain('<meta name="context7-site-verification" content="ask_b3fd9335a63f1b21b1a814ac"></head>');
			expect(html).toContain('<body><blockquote data-context7-ask="true" aria-hidden="true" class="sr-only">');
			expect(html).toContain("<h2>Search</h2><p>Page index: https://rxresu.me/llms.txt.</p>");
			expect(html).toContain(
				"https://context7.com/api/v2/ask?siteKey=ask_b3fd9335a63f1b21b1a814ac&amp;query=&lt;URL-encoded question&gt;",
			);
			expect(html).toContain('</blockquote><div id="app"></div>');
			expect(html).not.toContain("Add .md");
			expect(response.headers.get("Link")).toBe(searchLink);
			const head = await handleWebApp(new Request(`https://rxresu.me${path}`, { method: "HEAD" }));
			expect(head.headers.get("Link")).toBe(searchLink);
			expect(await head.text()).toBe("");
		},
	);

	it("injects canonical metadata and structured data into tracking-parameter root requests only", async () => {
		vi.mocked(fs.readFile).mockResolvedValue(`
			<!doctype html>
			<html>
				<head>
					<title>Reactive Resume — A free and open-source resume builder</title>
					<meta
						name="description"
						content="Reactive Resume is a free and open-source resume builder that makes it easy to create, update, and share your resume."
					>
				</head>
				<body><div id="app"></div></body>
			</html>
		`);

		const response = await handleWebApp(new Request("http://server.internal/?utm_source=search"));
		const html = await response.text();

		expect(html).toContain('<link rel="canonical" href="https://rxresu.me/">');
		expect(html).toContain('<meta property="og:url" content="https://rxresu.me/">');
		expect(html).toContain('<script type="application/ld+json">');
		expect(html).toContain(
			'<meta property="og:description" content="Reactive Resume is a free and open-source resume builder that makes it easy to create, update, and share your resume.">',
		);
		expect(html).toContain('"contactType":"support","email":"amruth@rxresu.me"');
		expect(html).not.toContain("utm_source");

		const dashboardResponse = await handleWebApp(new Request("https://example.com/dashboard"));
		expect(await dashboardResponse.text()).not.toContain('rel="canonical"');
	});

	it("serves the homepage prerendered in the requested or saved locale, with hreflang alternates", async () => {
		vi.mocked(fs.readFile).mockImplementation((path) => {
			const locale = String(path).match(/dist-prerender\/home\/(.+)\.html$/)?.[1];
			return Promise.resolve(`<html><head></head><body><div id="app">${locale ?? "shell"}</div></body></html>`);
		});

		const german = await handleWebApp(new Request("https://example.com/?locale=de-DE"));
		const html = await german.text();
		expect(html).toContain('<div id="app">de-DE</div>');
		expect(html).toContain('<link rel="canonical" href="https://rxresu.me/?locale=de-DE">');
		expect(html).toContain('<link rel="alternate" hreflang="x-default" href="https://rxresu.me/">');
		expect(german.headers.get("Vary")).toBe("Cookie");

		const saved = new Request("https://example.com/", { headers: { cookie: "theme=dark; locale=ar-SA" } });
		const savedHtml = await (await handleWebApp(saved)).text();
		expect(savedHtml).toContain('<div id="app">ar-SA</div>');
		expect(savedHtml).toContain('<link rel="canonical" href="https://rxresu.me/">');

		// Only known locales name a file, so the parameter can't point anywhere else.
		const unknown = await handleWebApp(new Request("https://example.com/?locale=../../index"));
		expect(await unknown.text()).toContain('<div id="app">en-US</div>');
	});

	describe.each(["ats-checker", "resume-templates"])("the %s page", (path) => {
		const shell = `<html><head><title>Reactive Resume — A free and open-source resume builder</title><meta name="description" content="Marketing copy."></head><body></body></html>`;

		it("serves an indexable shell rather than a 404", async () => {
			vi.mocked(fs.readFile).mockResolvedValue(shell);

			const response = await handleWebApp(new Request(`https://example.com/${path}`));

			expect(response.status).toBe(200);
			expect(response.headers.get("Content-Type")).toBe("text/html; charset=UTF-8");
			expect(response.headers.get("X-Robots-Tag")).toBeNull();
		});

		it("serves the prerendered page in the requested locale, with its own title on the social cards", async () => {
			vi.mocked(fs.readFile).mockImplementation((path) => {
				const match = String(path).match(/dist-prerender\/(?:ats-checker|resume-templates)\/(.+)\.html$/);
				if (!match) return Promise.resolve(shell);
				return Promise.resolve(
					`<html><head><title>ATS-Prüfung &amp; mehr</title><meta name="description" content="Lesbar?"></head><body><div id="app">${match[1]}</div></body></html>`,
				);
			});

			const html = await (await handleWebApp(new Request(`https://example.com/${path}?locale=de-DE`))).text();

			expect(html).toContain('<div id="app">de-DE</div>');
			expect(html).toContain(`<link rel="canonical" href="https://rxresu.me/${path}?locale=de-DE">`);
			expect(html).toContain('<meta property="og:title" content="ATS-Prüfung &amp; mehr">');
			expect(html).toContain('<meta property="og:locale" content="de_DE">');
		});
	});

	it.each(["/", "/dashboard"])("sets framing and CSP security headers on %s", async (pathname) => {
		const response = await handleWebApp(new Request(`https://example.com${pathname}`));

		expect(response.status).toBe(200);
		expect(response.headers.get("X-Frame-Options")).toBe("DENY");
		expect(response.headers.get("X-Content-Type-Options")).toBe("nosniff");
		expect(response.headers.get("Content-Security-Policy")).toContain("frame-ancestors 'none'");
	});

	it("allows exactly the page's own inline scripts, by hash", async () => {
		const response = await handleWebApp(
			new Request("https://example.com/dashboard"),
			async () => '<html><script>boot()</script><script type="module" src="/app.js"></script></html>',
		);
		const scripts = response.headers.get("Content-Security-Policy")?.match(/script-src ([^;]*)/)?.[1];

		expect(scripts).toBe(
			`'self' 'wasm-unsafe-eval' https://static.cloudflareinsights.com 'sha256-${createHash("sha256").update("boot()").digest("base64")}'`,
		);
	});

	it("tags pages for the release purge and preloads their stylesheet and fonts for Early Hints", async () => {
		const response = await handleWebApp(
			new Request("https://example.com/"),
			async () =>
				'<html><head><link rel="icon" href="/favicon.ico"><link rel="stylesheet" crossorigin href="/assets/index-a.css"><link rel="preload" as="font" type="font/woff2" href="/assets/figtree-b.woff2" crossorigin></head><body><div id="app"></div></body></html>',
		);

		expect(response.headers.get("Cache-Tag")).toBe("html");
		expect(response.headers.get("Link")).toBe(
			`${searchLink}, </assets/index-a.css>; rel=preload; as=style; crossorigin, </assets/figtree-b.woff2>; rel=preload; as=font; crossorigin`,
		);
	});

	it.each(["/auth/login", "/dashboard", "/builder/resume-1", "/agent"])(
		"serves noindex shell for known app prefix %s",
		async (pathname) => {
			const response = await handleWebApp(new Request(`https://example.com${pathname}`));

			expect(response.status).toBe(200);
			expect(response.headers.get("Content-Type")).toBe("text/html; charset=UTF-8");
			expect(response.headers.get("X-Robots-Tag")).toBe("noindex, follow");
			expect(await response.text()).toBe("<html>app</html>");
		},
	);

	it.each(["/templates", "/templates/azurill", "/templates/azurill.pdf"])(
		"returns 404 for retired template preview %s",
		async (pathname) => {
			const response = await handleWebApp(new Request(`https://example.com${pathname}`));

			expect(response.status).toBe(404);
			expect(await response.text()).not.toContain("<html>app</html>");
			expect(fs.readFile).not.toHaveBeenCalled();
		},
	);
});
