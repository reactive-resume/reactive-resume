import { readFile } from "node:fs/promises";
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

it("does not cache a truncated font with a valid signature, so repairing the same URL permits retry", async () => {
	vi.stubEnv("FONT_MIRROR_URL", "https://repaired-mirror.example/fonts");
	let bytes = new Uint8Array([0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
	const fetcher = vi.fn(async () => new Response(bytes));
	vi.stubGlobal("fetch", fetcher);
	const data = structuredClone(defaultResumeData);
	data.basics.name = "Retry restored font";
	await expect(act(() => createResumePdfFile({ data, filename: "retry.pdf" }))).rejects.toThrow(
		"Fonts could not be loaded",
	);
	const failedRequests = fetcher.mock.calls.length;
	bytes = new Uint8Array(
		await readFile(new URL("../../../../apps/web/public/fonts/ibm-plex-serif-400.ttf", import.meta.url)),
	);
	const file = await act(() => createResumePdfFile({ data, filename: "retry.pdf" }));
	expect(file.type).toBe("application/pdf");
	expect(fetcher.mock.calls.length).toBeGreaterThan(failedRequests);
	expect(file.size).toBeGreaterThan(5_000);
});
