import { expect, it, vi } from "vitest";
import { loadModelSuggestions } from "./catalog";

it("suggests current text models with provider-specific IDs and tolerates incomplete catalog entries", async () => {
	const model = {
		id: "openai/gpt-example",
		name: "GPT Example",
		release_date: "2026-09-01",
		modalities: { input: ["text", "image"], output: ["text"] },
		limit: { context: 128000, output: 8192 },
	};
	const fetchCatalog = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
		Response.json({
			vercel: {
				models: {
					chat: model,
					older: { ...model, id: "anthropic/claude-example", name: "Claude Example", release_date: "2026-08-01" },
					retired: { ...model, id: "retired", status: "deprecated" },
					audio: { ...model, id: "audio", modalities: { input: ["audio"], output: ["text"] } },
					image: { ...model, id: "image", modalities: { input: ["text"], output: ["image"] } },
					embedding: { ...model, id: "embedding", limit: { context: 8192, output: 0 } },
					incomplete: { name: "Incomplete entry" },
				},
			},
			google: { models: { chat: { ...model, id: "gemini-example", name: "Gemini Example" } } },
			"fireworks-ai": { models: { chat: { ...model, id: "accounts/fireworks/models/example" } } },
			"ollama-cloud": { models: { chat: { ...model, id: "example:cloud" } } },
			anthropic: null,
		}),
	);
	try {
		const catalog = await loadModelSuggestions(new AbortController().signal);
		expect(catalog.vercel?.map(({ id, name }) => ({ id, name }))).toEqual([
			{ id: "openai/gpt-example", name: "GPT Example" },
			{ id: "anthropic/claude-example", name: "Claude Example" },
		]);
		expect(catalog.google?.[0]?.id).toBe("gemini-example");
		expect(catalog["fireworks-ai"]?.[0]?.id).toBe("accounts/fireworks/models/example");
		expect(catalog["ollama-cloud"]?.[0]?.id).toBe("example:cloud");
		expect(catalog.anthropic).toEqual([]);

		fetchCatalog.mockResolvedValueOnce(new Response("Unavailable", { status: 503 }));
		await expect(loadModelSuggestions(new AbortController().signal)).rejects.toThrow("unavailable");
		fetchCatalog.mockResolvedValueOnce(Response.json(null));
		await expect(loadModelSuggestions(new AbortController().signal)).rejects.toThrow();
	} finally {
		fetchCatalog.mockRestore();
	}
});
