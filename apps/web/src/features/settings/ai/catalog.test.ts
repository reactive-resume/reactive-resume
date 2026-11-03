import { expect, it, vi } from "vite-plus/test";
import { describeTest, providerDefaults } from "./catalog";

it("formats provider latency in the interface locale", () => {
	const labels = { connected: "Connected", failed: "Failed" };
	expect(describeTest({ testStatus: "success", testError: null }, 1234.4, labels, "ar-SA").label).toBe(
		"Connected · ١٬٢٣٤ ms",
	);
	expect(describeTest({ testStatus: "failure", testError: "Unavailable" }, 1234.4, labels, "ar-SA")).toEqual({
		ok: false,
		label: "Failed",
		error: "Unavailable",
	});
});

it("offers curated defaults offline and preserves provider-specific model IDs", () => {
	const fetch = vi.spyOn(globalThis, "fetch");
	expect(providerDefaults("vercel-ai-gateway").model).toMatch(/^openai\//);
	expect(providerDefaults("openai-compatible")).toEqual({ baseURL: "", model: "" });
	expect(fetch).not.toHaveBeenCalled();
	fetch.mockRestore();
});
