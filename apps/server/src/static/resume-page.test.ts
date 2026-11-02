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

it("sends a mistyped app address to the app instead of saying a resume isn't shared (J2-16)", async () => {
	const { loadPublicWebPage } = await import("@reactive-resume/api/features/resume/web-page");
	vi.mocked(loadPublicWebPage).mockResolvedValue({ status: "unavailable" } as never);
	const { serveResumePage } = await import("./resume-page");

	const profile = await serveResumePage(
		new Request("https://resume.example/applications"),
		{ username: "applications", primary: true },
		"test",
	);
	expect(profile.status).toBe(302);
	expect(profile.headers.get("location")).toBe("/dashboard/applications");

	const nested = await serveResumePage(
		new Request("https://resume.example/settings/profile?x=1"),
		{ username: "settings", slug: "profile" },
		"test",
	);
	expect(nested.headers.get("location")).toBe("/dashboard/settings/profile?x=1");

	// Any other address that isn't a shared resume still says so.
	const unknown = await serveResumePage(
		new Request("https://resume.example/ada/resume"),
		{ username: "ada", slug: "resume" },
		"test",
	);
	expect(unknown.status).toBe(404);
});

it("still shows a shared resume whose owner's username looks like an app page", async () => {
	const { loadPublicWebPage } = await import("@reactive-resume/api/features/resume/web-page");
	vi.mocked(loadPublicWebPage).mockResolvedValue({
		status: "ready",
		data: structuredClone(defaultResumeData),
		username: "career",
		slug: "resume",
		updatedAt: new Date(),
		indexable: false,
		hasPassword: false,
		showDownloadButtons: false,
		customDomain: null,
	} as never);
	const { serveResumePage } = await import("./resume-page");
	const response = await serveResumePage(
		new Request("https://resume.example/career/resume"),
		{ username: "career", slug: "resume" },
		"test",
	);
	expect(response.status).toBe(200);
});

it.each([
	["", undefined, "de-DE", "de-DE"],
	["", "fr-FR", "de-DE", "fr-FR"],
	["?locale=ja-JP", "fr-FR", "de-DE", "ja-JP"],
	["", "zu-ZA", "de-DE", "en-US"],
])(
	"keeps explicit language ahead of the header on unavailable pages: %s %s",
	async (search, saved, header, expected) => {
		const { loadPublicWebPage } = await import("@reactive-resume/api/features/resume/web-page");
		vi.mocked(loadPublicWebPage).mockResolvedValue({ status: "unavailable" } as never);
		const { serveResumePage } = await import("./resume-page");

		const response = await serveResumePage(
			new Request(`https://resume.example/unshared-user${search}`, {
				headers: { "accept-language": header, ...(saved ? { cookie: `theme=light; locale=${saved}` } : {}) },
			}),
			{ username: "unshared-user", primary: true },
			"test",
		);

		const html = await response.text();
		expect(response.status).toBe(404);
		expect(html).toMatch(/<a class="home" href="https:\/\/resume\.example\/">.*<\/a><\/main>/);
		expect(html).toContain(`lang="${expected}"`);
		expect(response.headers.get("Cache-Control")).toBe("private, no-store");
	},
);
