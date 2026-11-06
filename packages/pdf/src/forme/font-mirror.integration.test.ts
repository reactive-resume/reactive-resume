import { afterEach, expect, it, vi } from "vite-plus/test";
import { act } from "react";
import { defaultResumeData } from "@reactive-resume/schema/resume/default";
import { createResumePdfFile } from "../server";

afterEach(() => {
	vi.unstubAllGlobals();
	vi.unstubAllEnvs();
});

it("fails an export when a misconfigured mirror returns an HTML fallback with HTTP 200", async () => {
	vi.stubEnv("FONT_MIRROR_URL", "https://broken-mirror.example/fonts");
	const requests: string[] = [];
	const fetcher = vi.fn(async (source: URL | string) => {
		requests.push(String(source));
		return new Response("<!doctype html><title>Static host fallback</title>");
	});
	vi.stubGlobal("fetch", fetcher);
	const data = structuredClone(defaultResumeData);
	data.basics.name = "Font mirror";
	await expect(act(() => createResumePdfFile({ data, filename: "invalid.pdf" }))).rejects.toThrow();
	expect(fetcher).toHaveBeenCalled();
	expect(requests.every((source) => source.startsWith("https://broken-mirror.example/fonts/"))).toBe(true);
});
