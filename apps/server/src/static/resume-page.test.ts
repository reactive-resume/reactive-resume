import { createHash } from "node:crypto";
import { expect, it, vi } from "vite-plus/test";
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
		new Request("https://resume.example/ada/resume"),
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
