import { describe, expect, it } from "vite-plus/test";
import { AI_PROVIDER_DEFAULT_BASE_URLS, isDirectAiProvider, supportsNativeWebSearch } from "./types";

describe("native search destination", () => {
	it.each(["openai", "anthropic", "gemini"] as const)("accepts only official %s destinations", (provider) => {
		const baseURL = AI_PROVIDER_DEFAULT_BASE_URLS[provider];
		expect(supportsNativeWebSearch({ provider })).toBe(true);
		expect(supportsNativeWebSearch({ provider, baseURL: `${baseURL}/` })).toBe(true);
		for (const address of [
			"https://proxy.example.test/v1",
			`${baseURL}?key=secret`,
			`${baseURL}#fragment`,
			baseURL.replace("https://", "https://name:secret@"),
			baseURL.replace("https://", "http://"),
		]) {
			expect(supportsNativeWebSearch({ provider, baseURL: address })).toBe(false);
		}
	});

	it("does not assume a compatible API or gateway supports provider tools", () => {
		for (const provider of ["openai-compatible", "vercel-ai-gateway", "openrouter", "ollama", "deepseek"] as const) {
			expect(supportsNativeWebSearch({ provider })).toBe(false);
		}
		expect(isDirectAiProvider({ provider: "openai", baseURL: "https://api.openai.com.evil.test/v1" })).toBe(false);
		expect(isDirectAiProvider({ provider: "openai", baseURL: "not a URL" })).toBe(false);
	});
});
