import type { AIProvider } from "./types";
import { expect, it } from "vite-plus/test";
import { getAIProviderSetupProblem } from "./defaults";

it.each([
	["openai-compatible", "", "stub-key", "stub", false, "baseURL"],
	["openai-compatible", "gateway.example.test/v1", "stub-key", "stub", false, "baseURL"],
	["openai-compatible", "ftp://gateway.example.test/v1", "stub-key", "stub", false, "baseURL"],
	["openai-compatible", "http://", "stub-key", "stub", false, "baseURL"],
	["openai-compatible", " https://gateway.example.test/v1 ", " stub-key ", " stub ", false, null],
	["openai-compatible", "http://127.0.0.1:8080/v1", "", "stub", false, "apiKey"],
	["openai", "", "stub-key", "stub", false, null],
	["openai", "https://api.openai.com/v1", "", "stub", false, "apiKey"],
	["openai", "https://api.openai.com/v1", "", "stub", true, null],
	["openai", "https://gateway.example.test/v1", "", "stub", false, "apiKey"],
	["ollama", "http://localhost:11434", "", "stub", false, null],
	["ollama", "", "", "stub", false, null],
	["openai", "", "stub-key", "  ", false, "model"],
] as const)("checks setup for %s at %s", (provider: AIProvider, baseURL, apiKey, model, hasSavedKey, expected) => {
	expect(getAIProviderSetupProblem(provider, { baseURL, apiKey, model }, hasSavedKey)).toBe(expected);
});
