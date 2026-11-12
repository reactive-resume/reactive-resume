import { describe, expect, it } from "vite-plus/test";
import { providerInput, updateProviderInput } from "./inputs";

describe("AI provider router input", () => {
	it("allows keyless local providers while requiring other providers' keys", () => {
		const input = {
			label: "Local",
			provider: "ollama",
			model: "llama3.2",
			apiKey: "",
			baseURL: "http://localhost:11434/v1",
		};
		expect(providerInput.safeParse(input).success).toBe(true);
		expect(providerInput.safeParse({ ...input, provider: "openai-compatible" }).success).toBe(true);
		expect(providerInput.safeParse({ ...input, provider: "openai" }).success).toBe(false);
	});
	it("allows a keyless OpenAI-compatible update that changes the base URL", () => {
		const update = {
			id: "provider-1",
			provider: "openai-compatible",
			baseURL: "http://localhost:1234/v1",
			apiKey: "",
		};
		expect(updateProviderInput.safeParse(update).success).toBe(true);
		expect(updateProviderInput.safeParse({ ...update, provider: "openai" }).success).toBe(false);
	});
	it("does not default baseURL on switch-only updates", () => {
		expect(updateProviderInput.parse({ id: "provider-1", enabled: false })).not.toHaveProperty("baseURL");
	});
	it("accepts optional task models and allows clearing one", () => {
		const input = {
			label: "Local",
			provider: "ollama" as const,
			model: "llama3.2",
			apiKey: "",
			fastModel: "small",
			capableModel: "large",
		};
		expect(providerInput.parse(input)).toMatchObject({ fastModel: "small", capableModel: "large" });
		expect(updateProviderInput.parse({ id: "provider-1", capableModel: "" })).toMatchObject({
			capableModel: "",
		});
	});
});
