import { afterEach, expect, it, vi } from "vite-plus/test";
import { defaultResumeData } from "@reactive-resume/schema/resume/default";
import { createPreviewToken, grantResumeAccess } from "./access";
import { authorizePublicResumeDownload } from "./public-download";

const fixture = vi.hoisted(() => ({ find: vi.fn(), authentication: vi.fn() }));
vi.mock("./slugs", () => ({ findResume: fixture.find }));
vi.mock("../../context", () => ({ resolveAuthenticationFromRequestHeaders: fixture.authentication }));

// Exercise real signed cookies at the shared authorization boundary, including a valid signature after expiry.
afterEach(() => vi.useRealTimers());
it("expires password access, invalidates it on password change, and rejects preview tokens for downloads", async () => {
	vi.useFakeTimers();
	vi.setSystemTime(new Date("2026-11-03T00:00:00Z"));
	const resume = {
		id: "resume-1",
		userId: "owner",
		data: structuredClone(defaultResumeData),
		isPublic: true,
		hideContactDetails: false,
		showDownloadButtons: true,
		allowWordDownload: true,
		passwordHash: "first-hash",
	};
	fixture.find.mockResolvedValue(resume);
	fixture.authentication.mockResolvedValue(undefined);
	const response = new Headers();
	grantResumeAccess(response, resume.id, resume.passwordHash);
	const cookie = response.get("set-cookie")?.split(";")[0];
	if (!cookie) throw new Error("No access cookie");
	const input = {
		username: "morgan",
		slug: "resume",
		trustedClient: "203.0.113.9",
		requestHeaders: new Headers({ cookie }),
	};
	await expect(authorizePublicResumeDownload(input, "docx")).resolves.toMatchObject({ id: resume.id });
	resume.passwordHash = "changed-hash";
	await expect(authorizePublicResumeDownload(input, "docx")).rejects.toMatchObject({ code: "NEED_PASSWORD" });
	resume.passwordHash = "first-hash";
	vi.setSystemTime(new Date("2026-11-03T00:10:01Z"));
	await expect(authorizePublicResumeDownload(input, "docx")).rejects.toMatchObject({ code: "NEED_PASSWORD" });
	const preview = createPreviewToken(resume.id);
	await expect(
		authorizePublicResumeDownload(
			{ ...input, requestHeaders: new Headers({ cookie: `resume_access_${resume.id}=${preview}` }) },
			"docx",
		),
	).rejects.toMatchObject({ code: "NEED_PASSWORD" });
});
