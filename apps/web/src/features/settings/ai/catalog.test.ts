import { expect, it, vi } from "vite-plus/test";
import { providerDefaults } from "./catalog";

it("offers curated defaults offline and preserves provider-specific model IDs", () => {
	const fetch = vi.spyOn(globalThis, "fetch");
	expect(providerDefaults("vercel-ai-gateway").model).toMatch(/^openai\//);
	expect(providerDefaults("openai-compatible")).toEqual({ baseURL: "", model: "" });
	expect(fetch).not.toHaveBeenCalled();
	fetch.mockRestore();
});
