import fs from "node:fs/promises";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	env: { APP_URL: "https://rxresu.me", ROOT_RESUME_ID: undefined as string | undefined },
	serveStatic: vi.fn((_options?: unknown) => vi.fn()),
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

type StaticOptions = {
	onFound?: (
		path: string,
		context: {
			req: { path: string };
			header: (name: string, value: string) => void;
		},
	) => void | Promise<void>;
};

const { handleWebApp } = await import("./web");
const staticOptions = mocks.serveStatic.mock.calls[0]?.[0] as StaticOptions | undefined;

describe("web app fallback classification", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mocks.env.ROOT_RESUME_ID = undefined;
		vi.mocked(fs.readFile).mockResolvedValue("<html>app</html>");
		mocks.getPublicResumeSocialMeta.mockResolvedValue(null);
	});

	it("serves the shell for the root app route without noindex", async () => {
		const response = await handleWebApp(new Request("https://example.com/"));

		expect(response.status).toBe(200);
		expect(response.headers.get("Content-Type")).toBe("text/html; charset=UTF-8");
		expect(response.headers.get("X-Robots-Tag")).toBeNull();
		expect(await response.text()).toBe("<html>app</html>");
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
		expect(html).toContain('<link rel="preload" href="/videos/timelapse-v1.webp" as="image" fetchpriority="high">');
		expect(html).toContain('<meta property="og:url" content="https://rxresu.me/">');
		expect(html).toContain('<meta property="og:image" content="https://rxresu.me/opengraph/banner.jpg">');
		expect(html).toContain('id="reactive-resume-structured-data"');
		expect(html).toContain('"@type":["SoftwareApplication","WebApplication"]');
		expect(html).toContain('"url":"https://rxresu.me/"');
		expect(html).not.toContain("utm_source");

		const dashboardResponse = await handleWebApp(new Request("https://example.com/dashboard"));
		expect(await dashboardResponse.text()).not.toContain('rel="canonical"');
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

		it("replaces the shell metadata with the checker's own", async () => {
			vi.mocked(fs.readFile).mockResolvedValue(shell);

			const html = await (await handleWebApp(new Request("https://example.com/ats-checker"))).text();

			expect(html).toContain("<title>ATS Checker - Reactive Resume</title>");
			expect(html).toContain('<link rel="canonical" href="https://rxresu.me/ats-checker">');
			expect(html).toContain('<meta property="og:url" content="https://rxresu.me/ats-checker">');
			expect(html).toContain('<meta property="og:image" content="https://rxresu.me/opengraph/ats-checker.png">');
			expect(html).toContain('id="ats-checker-structured-data"');
			expect(html).not.toContain("Marketing copy.");
		});

		it("answers HEAD without a body", async () => {
			const response = await handleWebApp(new Request("https://example.com/ats-checker", { method: "HEAD" }));

			expect(response.status).toBe(200);
			expect(await response.text()).toBe("");
		});

		it("does not treat the checker path as a public resume owner", async () => {
			const response = await handleWebApp(new Request("https://example.com/ats-checker/anything"));

			expect(response.status).toBe(404);
			expect(mocks.getPublicResumeSocialMeta).not.toHaveBeenCalled();
		});
	});

	describe("public resume social cards", () => {
		const shell = `<html><head><title>Reactive Resume — A free and open-source resume builder</title><meta name="description" content="Marketing copy."></head><body></body></html>`;

		it("injects resume-specific social metadata and replaces the shell title", async () => {
			vi.mocked(fs.readFile).mockResolvedValue(shell);
			mocks.getPublicResumeSocialMeta.mockResolvedValue({
				name: "Jane Doe",
				title: "Jane Doe — Staff Engineer",
				description: "Builds resilient distributed systems.",
				template: "azurill",
			});

			const html = await (await handleWebApp(new Request("https://example.com/jane/resume"))).text();

			expect(mocks.getPublicResumeSocialMeta).toHaveBeenCalledWith({ username: "jane", slug: "resume" });
			expect(html).toContain("<title>Jane Doe - Reactive Resume</title>");
			expect(html).toContain('<meta name="description" content="Builds resilient distributed systems.">');
			expect(html).not.toContain("Marketing copy.");
			expect(html).toContain('<link rel="canonical" href="https://rxresu.me/jane/resume">');
			expect(html).toContain('<meta property="og:type" content="profile">');
			expect(html).toContain('<meta property="og:title" content="Jane Doe — Staff Engineer">');
			expect(html).toContain('<meta property="og:image" content="https://rxresu.me/opengraph/banner.jpg">');
			expect(html).toContain('<meta name="twitter:card" content="summary_large_image">');
			expect(html).toContain('<meta name="twitter:image" content="https://rxresu.me/opengraph/banner.jpg">');
		});

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

		it("serves the plain shell when the resume is not publicly shareable", async () => {
			vi.mocked(fs.readFile).mockResolvedValue(shell);

			const html = await (await handleWebApp(new Request("https://example.com/jane/private"))).text();

			expect(html).toBe(shell);
		});

		it("serves the plain shell when the lookup fails", async () => {
			vi.mocked(fs.readFile).mockResolvedValue(shell);
			mocks.getPublicResumeSocialMeta.mockRejectedValue(new Error("database unavailable"));

			const response = await handleWebApp(new Request("https://example.com/jane/resume"));

			expect(response.status).toBe(200);
			await expect(response.text()).resolves.toBe(shell);
		});
	});

	it("caches versioned homepage media immutably", async () => {
		const headers = new Headers();

		await staticOptions?.onFound?.("", {
			req: { path: "/videos/timelapse-v1.mp4" },
			header: (name, value) => headers.set(name, value),
		});

		expect(headers.get("Cache-Control")).toBe("public, max-age=31536000, immutable");

		const unversionedHeaders = new Headers();
		await staticOptions?.onFound?.("", {
			req: { path: "/videos/timelapse.mp4" },
			header: (name, value) => unversionedHeaders.set(name, value),
		});

		expect(unversionedHeaders.get("Cache-Control")).toBeNull();
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

	it("serves noindex shell for public resume shaped routes", async () => {
		const response = await handleWebApp(new Request("https://example.com/alice/resume"));

		expect(response.status).toBe(200);
		expect(response.headers.get("X-Robots-Tag")).toBe("noindex, follow");
		expect(await response.text()).toBe("<html>app</html>");
	});

	it("serves noindex shell for the feedback/critique page instead of a 404", async () => {
		const response = await handleWebApp(new Request("https://example.com/alice/resume/critique"));

		expect(response.status).toBe(200);
		expect(response.headers.get("Content-Type")).toBe("text/html; charset=UTF-8");
		expect(response.headers.get("X-Robots-Tag")).toBe("noindex, follow");
		expect(await response.text()).toBe("<html>app</html>");
		expect(mocks.getPublicResumeSocialMeta).not.toHaveBeenCalled();
	});

	it("still 404s a three-segment path that isn't the critique page", async () => {
		const response = await handleWebApp(new Request("https://example.com/alice/resume/download"));

		expect(response.status).toBe(404);
		expect(await response.text()).toBe("Not Found");
	});

	it("returns noindex 404 for unknown non-asset routes", async () => {
		const response = await handleWebApp(new Request("https://example.com/unknown/extra/path"));

		expect(response.status).toBe(404);
		expect(response.headers.get("Content-Type")).toBe("text/plain; charset=UTF-8");
		expect(response.headers.get("X-Robots-Tag")).toBe("noindex, nofollow");
		expect(await response.text()).toBe("Not Found");
		expect(fs.readFile).not.toHaveBeenCalled();
	});

	it.each(["/api/foo", "/mcp/foo", "/uploads/foo"])(
		"does not treat reserved two-segment path %s as a public resume",
		async (pathname) => {
			const response = await handleWebApp(new Request(`https://example.com${pathname}`));

			expect(response.status).toBe(404);
			expect(response.headers.get("Content-Type")).toBe("text/plain; charset=UTF-8");
			expect(response.headers.get("X-Robots-Tag")).toBe("noindex, nofollow");
			expect(await response.text()).toBe("Not Found");
			expect(fs.readFile).not.toHaveBeenCalled();
		},
	);

	it("returns plain 404 for missing asset-looking paths", async () => {
		const response = await handleWebApp(new Request("https://example.com/assets/missing.css"));

		expect(response.status).toBe(404);
		expect(response.headers.get("X-Robots-Tag")).toBeNull();
		expect(await response.text()).toBe("Not Found");
		expect(fs.readFile).not.toHaveBeenCalled();
	});

	it("mirrors fallback status and headers for HEAD without a body", async () => {
		const knownResponse = await handleWebApp(new Request("https://example.com/dashboard", { method: "HEAD" }));
		const unknownResponse = await handleWebApp(
			new Request("https://example.com/unknown/extra/path", { method: "HEAD" }),
		);

		expect(knownResponse.status).toBe(200);
		expect(knownResponse.headers.get("Content-Type")).toBe("text/html; charset=UTF-8");
		expect(knownResponse.headers.get("X-Robots-Tag")).toBe("noindex, follow");
		expect(await knownResponse.text()).toBe("");

		expect(unknownResponse.status).toBe(404);
		expect(unknownResponse.headers.get("Content-Type")).toBe("text/plain; charset=UTF-8");
		expect(unknownResponse.headers.get("X-Robots-Tag")).toBe("noindex, nofollow");
		expect(await unknownResponse.text()).toBe("");
	});
});

describe("configured root shell", () => {
	it.each(["GET", "HEAD"])("serves no-store noindex headers for %s", async (method) => {
		mocks.env.ROOT_RESUME_ID = "private-or-missing-id";
		const response = await handleWebApp(new Request("https://attacker.example/", { method }));
		expect(response.headers.get("X-Robots-Tag")).toBe("noindex, follow");
		expect(response.headers.get("Cache-Control")).toBe("private, no-store");
	});
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
