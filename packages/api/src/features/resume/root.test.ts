import { describe, expect, it, vi } from "vite-plus/test";
import { defaultResumeData } from "@reactive-resume/schema/resume/default";
import { getRootResume } from "./root";

const fixture = () => ({
	config: { rootResumeId: "root-id", appUrl: "https://resume.example/base?ignored=yes" },
	findTarget: vi.fn(async (_id: string) => ({ username: "owner", slug: "current-slug", isPublic: true })),
	getBySlug: vi.fn(async (_input: unknown) => ({
		id: "root-id",
		name: "Resume",
		slug: "current-slug",
		data: defaultResumeData,
		tags: [],
		isPublic: true,
		isLocked: false,
		showDownloadButtons: false,
		showInSearchEngines: false,
		hideContactDetails: false,
		showContactButton: true,
		isPrimary: false,
		hasPassword: false,
	})),
});
const request = { requestHeaders: new Headers({ host: "attacker.example", "x-forwarded-host": "attacker.example" }) };

describe("configured root public resume", () => {
	it.each([undefined, "", "   "])("disables root mode for %s without a lookup", async (rootResumeId) => {
		const deps = fixture();
		const result = await getRootResume(request, { ...deps, config: { ...deps.config, rootResumeId } });
		expect(result).toEqual({ status: "disabled" });
		expect(deps.findTarget).not.toHaveBeenCalled();
		expect(deps.getBySlug).not.toHaveBeenCalled();
	});

	it("resolves only configured ID and delegates once with public-only enforcement", async () => {
		const deps = fixture();
		const result = await getRootResume({ ...request, currentUserId: "owner-id" }, deps);
		expect(result).toMatchObject({
			status: "public",
			username: "owner",
			slug: "current-slug",
			canonicalUrl: "https://resume.example/",
			resume: { showDownloadButtons: false, hasPassword: false },
		});
		expect(deps.findTarget).toHaveBeenCalledExactlyOnceWith("root-id");
		expect(deps.getBySlug).toHaveBeenCalledExactlyOnceWith({
			...request,
			currentUserId: "owner-id",
			username: "owner",
			slug: "current-slug",
			requirePublic: true,
			expectedResumeId: "root-id",
		});
	});
});
