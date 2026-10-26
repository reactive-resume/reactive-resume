import { describe, expect, it, vi } from "vite-plus/test";

const mocks = vi.hoisted(() => ({ findPrimaryResume: vi.fn() }));

vi.mock("@reactive-resume/env/server", () => ({
	env: { APP_URL: "https://rxresu.me", SHORT_LINK_URL: "https://rx.cv" },
}));
vi.mock("@reactive-resume/api/features/resume/web-page", () => ({
	findPrimaryResume: mocks.findPrimaryResume,
}));

const { handleShortLink } = await import("./short-link");

const visit = (path: string) => handleShortLink(new Request(`https://rx.cv${path}`));

describe("short links", () => {
	it("send /<username> to the account's primary resume, without letting browsers keep the answer", async () => {
		mocks.findPrimaryResume.mockResolvedValueOnce({ slug: "game-dev", isPublic: true });
		const response = await visit("/Tess?ref=card");

		expect(mocks.findPrimaryResume).toHaveBeenCalledWith("Tess");
		expect(response.status).toBe(302);
		expect(response.headers.get("Location")).toBe("https://rxresu.me/tess/game-dev?ref=card");
	});

	it("say the resume isn't shared when the primary isn't published, or there is none", async () => {
		mocks.findPrimaryResume.mockResolvedValueOnce({ slug: "game-dev", isPublic: false });
		expect((await visit("/tess")).status).toBe(404);
		mocks.findPrimaryResume.mockResolvedValueOnce(null);
		expect((await visit("/nobody")).status).toBe(404);
	});

	it.each(["/", "/tess/game-dev", "/dashboard/resumes"])("move %s to the app's own address for good", async (path) => {
		const response = await visit(path);
		expect(response.status).toBe(301);
		expect(response.headers.get("Location")).toBe(`https://rxresu.me${path}`);
	});
});
