import { beforeEach, expect, it, vi } from "vite-plus/test";
import { defaultResumeData } from "@reactive-resume/schema/resume/default";

const getCard = vi.hoisted(() => vi.fn());
vi.mock("@reactive-resume/api/features/resume/social-meta", () => ({ getPublicResumeCardData: getCard }));
vi.mock("@reactive-resume/env/server", () => ({ env: { APP_URL: "https://resume.example" } }));
vi.mock("@reactive-resume/pdf/server", () => ({
	loadResumeCardAssets: async () => ({ fonts: [], headingFamily: "Fixture", bodyFamily: "Fixture", picture: null }),
}));
vi.mock("@resvg/resvg-wasm", () => ({
	initWasm: vi.fn(),
	Resvg: class {
		render() {
			return { asPng: () => Uint8Array.of(1) };
		}
		free() {}
	},
}));

const { handleResumeCard } = await import("./resume-card");
beforeEach(() => getCard.mockReset());

it.each([false, true])("uses the current alias cache policy even for cached images (released=%s)", async (released) => {
	getCard.mockResolvedValue({
		data: structuredClone(defaultResumeData),
		isPrimary: false,
		customDomain: null,
		isReleasedUsername: released,
	});
	const url = "https://resume.example/cards/jane/resume.png";
	const response = await handleResumeCard(new Request(url), "jane", "resume");
	expect(response.status).toBe(200);
	expect(response.headers.get("Cache-Control")).toBe(released ? "no-store" : "public, max-age=3600");
	const etag = response.headers.get("ETag");
	if (!etag) throw new Error("Missing card ETag");
	const unchanged = await handleResumeCard(new Request(url, { headers: { "If-None-Match": etag } }), "jane", "resume");
	expect(unchanged.status).toBe(304);
	expect(unchanged.headers.get("Cache-Control")).toBe(released ? "no-store" : "public, max-age=3600");
});
