import type { RouterOutput } from "@/api/client";
import { AI_PROVIDER_DEFAULT_BASE_URLS, AI_PROVIDER_DEFAULT_MODELS } from "@reactive-resume/ai/defaults";

export type SavedProvider = RouterOutput["aiProviders"]["list"][number];
export type AIProvider = SavedProvider["provider"];

// Provider labels are brand names and stay untranslated on purpose, so every locale shows the
// vendor's own spelling instead of a literal translation (e.g. "Google Gemini", not "谷歌双子座").
export const providerOptions: {
	value: AIProvider;
	label: string;
	keywords: string[];
	defaultBaseURL: string;
	defaultModel: string;
}[] = [
	{
		value: "openai",
		label: "OpenAI",
		keywords: ["openai", "gpt", "chatgpt"],
		defaultBaseURL: AI_PROVIDER_DEFAULT_BASE_URLS.openai,
		defaultModel: AI_PROVIDER_DEFAULT_MODELS.openai,
	},
	{
		value: "anthropic",
		label: "Anthropic Claude",
		keywords: ["anthropic", "claude", "ai"],
		defaultBaseURL: AI_PROVIDER_DEFAULT_BASE_URLS.anthropic,
		defaultModel: AI_PROVIDER_DEFAULT_MODELS.anthropic,
	},
	{
		value: "gemini",
		label: "Google Gemini",
		keywords: ["gemini", "google"],
		defaultBaseURL: AI_PROVIDER_DEFAULT_BASE_URLS.gemini,
		defaultModel: AI_PROVIDER_DEFAULT_MODELS.gemini,
	},
	{
		value: "vercel-ai-gateway",
		label: "Vercel AI Gateway",
		keywords: ["vercel", "gateway", "ai"],
		defaultBaseURL: AI_PROVIDER_DEFAULT_BASE_URLS["vercel-ai-gateway"],
		defaultModel: AI_PROVIDER_DEFAULT_MODELS["vercel-ai-gateway"],
	},
	{
		value: "openrouter",
		label: "OpenRouter",
		keywords: ["openrouter", "router"],
		defaultBaseURL: AI_PROVIDER_DEFAULT_BASE_URLS.openrouter,
		defaultModel: AI_PROVIDER_DEFAULT_MODELS.openrouter,
	},
	{
		value: "mistral",
		label: "Mistral AI",
		keywords: ["mistral", "magistral"],
		defaultBaseURL: AI_PROVIDER_DEFAULT_BASE_URLS.mistral,
		defaultModel: AI_PROVIDER_DEFAULT_MODELS.mistral,
	},
	{
		value: "cohere",
		label: "Cohere",
		keywords: ["cohere", "command"],
		defaultBaseURL: AI_PROVIDER_DEFAULT_BASE_URLS.cohere,
		defaultModel: AI_PROVIDER_DEFAULT_MODELS.cohere,
	},
	{
		value: "xai",
		label: "xAI Grok",
		keywords: ["xai", "grok"],
		defaultBaseURL: AI_PROVIDER_DEFAULT_BASE_URLS.xai,
		defaultModel: AI_PROVIDER_DEFAULT_MODELS.xai,
	},
	{
		value: "groq",
		label: "Groq",
		keywords: ["groq", "llama"],
		defaultBaseURL: AI_PROVIDER_DEFAULT_BASE_URLS.groq,
		defaultModel: AI_PROVIDER_DEFAULT_MODELS.groq,
	},
	{
		value: "deepseek",
		label: "DeepSeek",
		keywords: ["deepseek"],
		defaultBaseURL: AI_PROVIDER_DEFAULT_BASE_URLS.deepseek,
		defaultModel: AI_PROVIDER_DEFAULT_MODELS.deepseek,
	},
	{
		value: "togetherai",
		label: "Together.ai",
		keywords: ["together", "togetherai", "llama"],
		defaultBaseURL: AI_PROVIDER_DEFAULT_BASE_URLS.togetherai,
		defaultModel: AI_PROVIDER_DEFAULT_MODELS.togetherai,
	},
	{
		value: "fireworks",
		label: "Fireworks",
		keywords: ["fireworks", "llama", "deepseek"],
		defaultBaseURL: AI_PROVIDER_DEFAULT_BASE_URLS.fireworks,
		defaultModel: AI_PROVIDER_DEFAULT_MODELS.fireworks,
	},
	{
		value: "cerebras",
		label: "Cerebras",
		keywords: ["cerebras", "llama"],
		defaultBaseURL: AI_PROVIDER_DEFAULT_BASE_URLS.cerebras,
		defaultModel: AI_PROVIDER_DEFAULT_MODELS.cerebras,
	},
	{
		value: "perplexity",
		label: "Perplexity",
		keywords: ["perplexity", "sonar"],
		defaultBaseURL: AI_PROVIDER_DEFAULT_BASE_URLS.perplexity,
		defaultModel: AI_PROVIDER_DEFAULT_MODELS.perplexity,
	},
	{
		value: "ollama",
		label: "Ollama",
		keywords: ["ollama", "cloud"],
		defaultBaseURL: AI_PROVIDER_DEFAULT_BASE_URLS.ollama,
		defaultModel: AI_PROVIDER_DEFAULT_MODELS.ollama,
	},
	{
		value: "openai-compatible",
		label: "OpenAI-compatible",
		keywords: ["compatible", "custom", "gateway"],
		defaultBaseURL: AI_PROVIDER_DEFAULT_BASE_URLS["openai-compatible"],
		defaultModel: AI_PROVIDER_DEFAULT_MODELS["openai-compatible"],
	},
];

// Prefill Base URL + Model from the provider's known defaults when the provider changes.
export function providerDefaults(provider: AIProvider) {
	const option = providerOptions.find((entry) => entry.value === provider);
	return {
		baseURL: option?.defaultBaseURL ?? AI_PROVIDER_DEFAULT_BASE_URLS[provider] ?? "",
		model: option?.defaultModel ?? "",
	};
}

export function providerLabel(provider: AIProvider) {
	return String(providerOptions.find((option) => option.value === provider)?.label ?? provider);
}

/** "…9f2a" from the stored preview ("sk-a...9f2a"); short keys only ever show dots. */
export function keyEnding(preview: string) {
	const [, end] = preview.split("...");
	return end ? `…${end}` : preview;
}
