import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vite-plus/test";
import { WEB_PAGE_SCRIPT } from "@reactive-resume/pdf/web-page-document";
import { defaultResumeData } from "@reactive-resume/schema/resume/default";

vi.mock("@reactive-resume/env/server", () => ({ env: { APP_URL: "https://resume.example" } }));

vi.mock("@reactive-resume/api/features/resume/web-page", () => ({
	loadPublicWebPage: vi.fn(),
	verifyWebPagePassword: vi.fn(),
}));
vi.mock("@reactive-resume/pdf/web-page", () => ({
	renderResumeWebPage: vi.fn(async () => ({ lang: "en-US", html: "<svg><script>untrusted()</script></svg>", css: "" })),
	webPageImageUrl: () => () => undefined,
}));

const { movedResponse } = await import("./resume-page");

describe("a moved public resume", () => {
	it("redirects a previous slug permanently to the document's address", () => {
		const response = movedResponse(new Request("https://rxresu.me/tess/old-address?preview=x"), {
			username: "tess",
			slug: "new-address",
			isPrimary: false,
			movedBy: "slug",
		});
		expect(response.status).toBe(301);
		expect(response.headers.get("Location")).toBe("/tess/new-address?preview=x");
		expect(response.headers.get("Cache-Control")).toBe("no-store");
	});

	it("redirects a previous username temporarily, without caching", () => {
		const response = movedResponse(new Request("https://rxresu.me/old-name/game-dev"), {
			username: "tess",
			slug: "game-dev",
			isPrimary: false,
			movedBy: "username",
		});
		expect(response.status).toBe(302);
		expect(response.headers.get("Location")).toBe("/tess/game-dev");
		// The name can be claimed again after 30 days; a cached permanent redirect would then open another account.
		expect(response.headers.get("Cache-Control")).toBe("no-store");
	});

	it("sends an old username's primary short link to the account's current short link", () => {
		const response = movedResponse(new Request("https://rxresu.me/old-name"), {
			username: "tess",
			slug: "game-dev",
			isPrimary: true,
			movedBy: "username",
		});
		expect(response.status).toBe(302);
		expect(response.headers.get("Location")).toBe("/tess");
	});
});

it("authorizes only the fixed application script, even if rendered content contains a script", async () => {
	const { loadPublicWebPage } = await import("@reactive-resume/api/features/resume/web-page");
	vi.mocked(loadPublicWebPage).mockResolvedValue({
		status: "ready",
		data: structuredClone(defaultResumeData),
		username: "ada",
		slug: "resume",
		updatedAt: new Date(),
		indexable: false,
		hasPassword: false,
		showDownloadButtons: false,
		customDomain: null,
	} as never);
	const { serveResumePage } = await import("./resume-page");
	const response = await serveResumePage(
		new Request("https://rxresu.me/ada/resume"),
		{ username: "ada", slug: "resume" },
		"test",
	);
	const csp = response.headers.get("content-security-policy");
	const hash = (script: string) => createHash("sha256").update(script).digest("base64");
	expect(response.status).toBe(200);
	expect(await response.text()).toContain("untrusted()");
	expect(csp).toContain(`'sha256-${hash(WEB_PAGE_SCRIPT)}'`);
	expect(csp).not.toContain(hash("untrusted()"));
	expect(csp?.match(/script-src ([^;]*)/)?.[1]).not.toContain("'unsafe-inline'");
});

it("gives a visitor at an address with no shared resume a way to the app's home, in their language", async () => {
	const { loadPublicWebPage } = await import("@reactive-resume/api/features/resume/web-page");
	vi.mocked(loadPublicWebPage).mockResolvedValue({ status: "unavailable" } as never);
	const { serveResumePage } = await import("./resume-page");

	const response = await serveResumePage(
		new Request("https://resume.example/login", { headers: { "accept-language": "de-DE" } }),
		{ username: "login", primary: true },
		"test",
	);

	const html = await response.text();
	expect(response.status).toBe(404);
	expect(html).toMatch(/<a class="home" href="https:\/\/resume\.example\/">.*<\/a><\/main>/);
	expect(html).toContain('lang="de-DE"');
});
