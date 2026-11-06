import { afterEach, expect, it, vi } from "vite-plus/test";
import { act } from "react";
import { defaultResumeData } from "@reactive-resume/schema/resume/default";
import { createResumePdfFile } from "./server";

// Stub only the PDF engine; exercise the real server entry, renderer and font fetch path.
vi.mock("@formepdf/core", () => ({
	prepareFont: undefined,
	renderSerializedDocWithLayout: () =>
		Promise.resolve({ pdf: new Uint8Array([1]), layout: { pages: [] }, warnings: [] }),
}));

afterEach(() => {
	vi.unstubAllEnvs();
	vi.unstubAllGlobals();
});

it("applies the complete mirror to every server font including script and symbol fallbacks", async () => {
	vi.stubEnv("FONT_MIRROR_URL", "https://self-host.example/fonts");
	vi.stubEnv("WEB_FONT_BASE_URL", "https://legacy.example/cm");
	const requested: string[] = [];
	vi.stubGlobal("fetch", (source: URL | string) => {
		requested.push(String(source));
		return Promise.resolve(new Response(new Uint8Array([0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0])));
	});
	const data = structuredClone(defaultResumeData);
	data.basics.name = "字体镜像 → العربية";
	data.metadata.typography.body.fontFamily = "Computer Modern Bright";
	await act(() => createResumePdfFile({ data, filename: "mirror.pdf" }));
	expect(requested.length).toBeGreaterThan(4);
	expect(requested.every((url) => url.startsWith("https://self-host.example/fonts/"))).toBe(true);
	expect(requested.some((url) => url.includes("/fonts.gstatic.com/"))).toBe(true);
	expect(requested.some((url) => url.includes("/cdn.jsdelivr.net/"))).toBe(true);
});

it.each([
	[undefined, "https://cdn.jsdelivr.net/gh/bitmaks/cm-web-fonts@latest"],
	[" https://fonts.example.com/cm/// ", "https://fonts.example.com/cm"],
])("applies server font configuration %s through the rendering pipeline", async (baseUrl, expectedBase) => {
	vi.stubEnv("WEB_FONT_BASE_URL", baseUrl);
	const requested: string[] = [];
	vi.stubGlobal("fetch", (source: URL | string) => {
		requested.push(String(source));
		return Promise.resolve(new Response(new Uint8Array([1, 2, 3])));
	});
	const data = structuredClone(defaultResumeData);
	data.basics.name = "Font mirror";
	data.metadata.typography.body.fontFamily = "Computer Modern Bright";
	data.metadata.typography.heading.fontFamily = "Computer Modern Bright";
	const file = await act(() => createResumePdfFile({ data, filename: "mirror.pdf" }));
	expect(file.type).toBe("application/pdf");
	expect(requested).toContain(`${expectedBase}/font/Bright/cmunbmr.woff`);
	expect(
		requested.filter((url) => url.includes("/font/Bright/")).every((url) => url.startsWith(`${expectedBase}/`)),
	).toBe(true);
});
