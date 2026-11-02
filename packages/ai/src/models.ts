import type { AIProvider } from "./types";

export type AIModelSuggestion = { id: string; name: string; recommendation?: "everyday" | "capable" };

// Reviewed against https://models.dev/api.json on 2026-11-02; only general-purpose text/tool models.
// shortcut: curated suggestions can lag provider availability; refresh when changing provider defaults.
const AI_PROVIDER_MODEL_SUGGESTIONS: Record<AIProvider, readonly AIModelSuggestion[]> = {
	openai: [
		{
			id: "gpt-6-luna",
			name: "GPT-6 Luna",
			recommendation: "everyday",
		},
		{
			id: "gpt-6-astra",
			name: "GPT-6 Astra",
			recommendation: "capable",
		},
		{
			id: "gpt-6.1-terra",
			name: "GPT-6.1 Terra",
		},
		{
			id: "gpt-4.1",
			name: "GPT-4.1",
		},
	],
	anthropic: [
		{
			id: "claude-haiku-5-5",
			name: "Claude Haiku 5.5",
			recommendation: "everyday",
		},
		{
			id: "claude-sonnet-5-5",
			name: "Claude Sonnet 5.5",
			recommendation: "capable",
		},
		{
			id: "claude-opus-5-5",
			name: "Claude Opus 5.5",
		},
	],
	gemini: [
		{
			id: "gemini-3.5-flash-lite",
			name: "Gemini 3.5 Flash Lite",
			recommendation: "everyday",
		},
		{
			id: "gemini-4-argon",
			name: "Gemini 4 Argon",
			recommendation: "capable",
		},
		{
			id: "gemini-3.8-flash",
			name: "Gemini 3.8 Flash",
		},
	],
	"vercel-ai-gateway": [
		{
			id: "openai/gpt-6-luna",
			name: "GPT-6 Luna",
			recommendation: "everyday",
		},
		{
			id: "anthropic/claude-sonnet-5.5",
			name: "Claude Sonnet 5.5",
			recommendation: "capable",
		},
		{
			id: "openai/gpt-6-astra",
			name: "GPT-6 Astra",
		},
	],
	openrouter: [
		{
			id: "anthropic/claude-haiku-5.5",
			name: "Claude Haiku 5.5",
			recommendation: "everyday",
		},
		{
			id: "anthropic/claude-sonnet-5.5",
			name: "Claude Sonnet 5.5",
			recommendation: "capable",
		},
		{
			id: "openai/gpt-6-astra",
			name: "GPT-6 Astra",
		},
	],
	mistral: [
		{
			id: "mistral-small-latest",
			name: "Mistral Small (latest)",
			recommendation: "everyday",
		},
		{
			id: "mistral-large-latest",
			name: "Mistral Large (latest)",
			recommendation: "capable",
		},
		{
			id: "mistral-medium-latest",
			name: "Mistral Medium (latest)",
		},
	],
	cohere: [
		{
			id: "command-r7b-12-2024",
			name: "Command R7B",
			recommendation: "everyday",
		},
		{
			id: "command-a-plus-05-2026",
			name: "Command A Plus",
			recommendation: "capable",
		},
		{
			id: "command-a-03-2025",
			name: "Command A",
		},
	],
	xai: [
		{
			id: "grok-4.3",
			name: "Grok 4.3",
			recommendation: "everyday",
		},
		{
			id: "grok-4.7",
			name: "Grok 4.7",
			recommendation: "capable",
		},
		{
			id: "grok-4.6",
			name: "Grok 4.6",
		},
	],
	groq: [
		{
			id: "openai/gpt-oss-20b",
			name: "GPT OSS 20B",
			recommendation: "everyday",
		},
		{
			id: "openai/gpt-oss-120b",
			name: "GPT OSS 120B",
			recommendation: "capable",
		},
	],
	deepseek: [
		{
			id: "deepseek-flash",
			name: "DeepSeek V4.1 Flash 1017",
			recommendation: "everyday",
		},
		{
			id: "deepseek-v4-pro",
			name: "DeepSeek V4 Pro",
			recommendation: "capable",
		},
	],
	togetherai: [
		{
			id: "deepseek-ai/DeepSeek-V4.1-Flash",
			name: "DeepSeek V4.1 Flash",
			recommendation: "everyday",
		},
		{
			id: "moonshotai/Kimi-K3",
			name: "Kimi K3",
			recommendation: "capable",
		},
		{
			id: "Qwen/Qwen3.7-Max",
			name: "Qwen3.7 Max",
		},
	],
	fireworks: [
		{
			id: "accounts/fireworks/models/deepseek-v4p1-flash-1017",
			name: "DeepSeek V4.1 Flash 1017",
			recommendation: "everyday",
		},
		{
			id: "accounts/fireworks/models/kimi-k3",
			name: "Kimi K3",
			recommendation: "capable",
		},
		{
			id: "accounts/fireworks/models/glm-5p3",
			name: "GLM 5.3",
		},
	],
	cerebras: [
		{
			id: "qwen-3.8-27b",
			name: "Qwen3.8 27B",
			recommendation: "everyday",
		},
		{
			id: "gpt-oss-120b",
			name: "GPT OSS 120B",
			recommendation: "capable",
		},
	],
	perplexity: [],
	ollama: [
		{
			id: "gpt-oss:20b",
			name: "gpt-oss:20b",
			recommendation: "everyday",
		},
		{
			id: "gpt-oss:120b",
			name: "gpt-oss:120b",
			recommendation: "capable",
		},
		{
			id: "mistral-large-4",
			name: "Mistral Large 4",
		},
	],
	"openai-compatible": [],
};

export function getAIProviderModelGroups(provider: AIProvider) {
	const models = AI_PROVIDER_MODEL_SUGGESTIONS[provider];
	return {
		recommended: models.filter((model) => model.recommendation),
		other: models.filter((model) => !model.recommendation),
	};
}
