import fs from "node:fs/promises";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	env: { APP_URL: "https://rxresu.me", ROOT_RESUME_ID: undefined as string | undefined },
	serveStatic: vi.fn(() => vi.fn()),
	getPublicResumeSocialMeta: vi.fn(),
}));

vi.mock("@reactive-resume/api/features/resume/social-meta", () => ({
	getPublicResumeSocialMeta: mocks.getPublicResumeSocialMeta,
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

describe("web app fallback classification", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mocks.env.ROOT_RESUME_ID = undefined;
		vi.mocked(fs.readFile).mockResolvedValue("<html>app</html>");
		mocks.getPublicResumeSocialMeta.mockResolvedValue(null);
	});

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

	describe("the ATS checker page", () => {
		const shell = `<html><head><title>Reactive Resume — A free and open-source resume builder</title><meta name="description" content="Marketing copy."></head><body></body></html>`;

		it("serves an indexable shell rather than a 404", async () => {
			vi.mocked(fs.readFile).mockResolvedValue(shell);

			const response = await handleWebApp(new Request("https://example.com/ats-checker"));

			expect(response.status).toBe(200);
			expect(response.headers.get("Content-Type")).toBe("text/html; charset=UTF-8");
			expect(response.headers.get("X-Robots-Tag")).toBeNull();
		});

		it("serves the prerendered page in the requested locale, with its own title on the social cards", async () => {
			vi.mocked(fs.readFile).mockImplementation((path) => {
				const match = String(path).match(/dist-prerender\/ats-checker\/(.+)\.html$/);
				if (!match) return Promise.resolve(shell);
				return Promise.resolve(
					`<html><head><title>ATS-Prüfung &amp; mehr</title><meta name="description" content="Lesbar?"></head><body><div id="app">${match[1]}</div></body></html>`,
				);
			});

			const html = await (await handleWebApp(new Request("https://example.com/ats-checker?locale=de-DE"))).text();

			expect(html).toContain('<div id="app">de-DE</div>');
			expect(html).toContain('<link rel="canonical" href="https://rxresu.me/ats-checker?locale=de-DE">');
			expect(html).toContain('<meta property="og:title" content="ATS-Prüfung &amp; mehr">');
			expect(html).toContain('<meta property="og:locale" content="de_DE">');
		});
	});

	describe("public resume social cards", () => {
		const shell = `<html><head><title>Reactive Resume — A free and open-source resume builder</title><meta name="description" content="Marketing copy."></head><body></body></html>`;

		it("escapes user-authored values so resume content cannot break out of the attribute", async () => {
			vi.mocked(fs.readFile).mockResolvedValue(shell);
			mocks.getPublicResumeSocialMeta.mockResolvedValue({
				name: 'Jane" onload="alert(1)',
				title: "<script>alert(1)</script>",
				description: 'Ends with " and & ampersand',
				template: "azurill",
			});

			const html = await (await handleWebApp(new Request("https://example.com/jane/resume"))).text();

			expect(html).not.toContain("<script>alert(1)</script>");
			expect(html).not.toContain('onload="alert(1)');
			expect(html).toContain('<meta property="og:title" content="&lt;script&gt;alert(1)&lt;/script&gt;">');
			expect(html).toContain('content="Ends with &quot; and &amp; ampersand"');
		});

		it("keeps replacement patterns in resume text literal", async () => {
			vi.mocked(fs.readFile).mockResolvedValue(shell);
			mocks.getPublicResumeSocialMeta.mockResolvedValue({
				name: "Jane $& $' Doe",
				title: "Jane Doe",
				description: "Costs $$ and $` nothing",
				template: "azurill",
			});

			const html = await (await handleWebApp(new Request("https://example.com/jane/resume"))).text();

			expect(html).toContain("<title>Jane $&amp; $&#39; Doe - Reactive Resume</title>");
			expect(html).toContain('<meta name="description" content="Costs $$ and $` nothing">');
		});
	});

	it.each(["/", "/alice/resume"])("sets framing and report-only CSP security headers on %s", async (pathname) => {
		const response = await handleWebApp(new Request(`https://example.com${pathname}`));

		expect(response.status).toBe(200);
		expect(response.headers.get("X-Frame-Options")).toBe("DENY");
		expect(response.headers.get("X-Content-Type-Options")).toBe("nosniff");
		expect(response.headers.get("Content-Security-Policy-Report-Only")).toContain("frame-ancestors 'none'");
	});

	it.each(["/auth/login", "/dashboard", "/builder/resume-1", "/agent", "/templates", "/templates/azurill.pdf"])(
		"serves noindex shell for known app prefix %s",
		async (pathname) => {
			const response = await handleWebApp(new Request(`https://example.com${pathname}`));

			expect(response.status).toBe(200);
			expect(response.headers.get("Content-Type")).toBe("text/html; charset=UTF-8");
			expect(response.headers.get("X-Robots-Tag")).toBe("noindex, follow");
			expect(await response.text()).toBe("<html>app</html>");
		},
	);
});

describe("configured root shell", () => {
	it("uses configured canonical root without leaking ID or marketing metadata", async () => {
		mocks.env.ROOT_RESUME_ID = "private-or-missing-id";
		vi.mocked(fs.readFile).mockResolvedValue(
			'<html><head><title>Marketing title</title><meta name="description" content="Marketing copy."></head><body></body></html>',
		);
		const html = await (
			await handleWebApp(
				new Request("https://attacker.example/?id=other", {
					headers: { host: "attacker.example", "x-forwarded-host": "evil.example" },
				}),
			)
		).text();
		expect(html).toContain('<link rel="canonical" href="https://rxresu.me/" data-root-resume-shell>');
		expect(html).toContain('<meta name="robots" content="noindex, follow" data-root-resume-shell>');
		expect(html).not.toMatch(/private-or-missing-id|attacker|evil|Marketing|application\/ld\+json|timelapse/);
	});
});
