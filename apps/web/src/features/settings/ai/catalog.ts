import type { ComboboxOption } from "@/components/ui/combobox";
import type { AIProvider } from "@reactive-resume/ai/types";
import { AI_PROVIDER_DEFAULT_BASE_URLS } from "@reactive-resume/ai/types";

export type AIProviderOption = ComboboxOption<AIProvider> & { defaultBaseURL: string; defaultModel: string };

// Provider labels are brand names and stay untranslated on purpose, so every locale shows the
// vendor's own spelling instead of a literal translation (e.g. "Google Gemini", not "谷歌双子座").
export const providerOptions: AIProviderOption[] = [
	{
		value: "openai",
		label: "OpenAI",
		keywords: ["openai", "gpt", "chatgpt"],
		defaultBaseURL: AI_PROVIDER_DEFAULT_BASE_URLS.openai,
		defaultModel: "gpt-4.1",
	},
	{
		value: "anthropic",
		label: "Anthropic Claude",
		keywords: ["anthropic", "claude", "ai"],
		defaultBaseURL: AI_PROVIDER_DEFAULT_BASE_URLS.anthropic,
		defaultModel: "claude-3-5-sonnet-latest",
	},
	{
		value: "gemini",
		label: "Google Gemini",
		keywords: ["gemini", "google"],
		defaultBaseURL: AI_PROVIDER_DEFAULT_BASE_URLS.gemini,
		defaultModel: "gemini-2.0-flash",
	},
	{
		value: "vercel-ai-gateway",
		label: "Vercel AI Gateway",
		keywords: ["vercel", "gateway", "ai"],
		defaultBaseURL: AI_PROVIDER_DEFAULT_BASE_URLS["vercel-ai-gateway"],
		defaultModel: "openai/gpt-4.1",
	},
	{
		value: "openrouter",
		label: "OpenRouter",
		keywords: ["openrouter", "router"],
		defaultBaseURL: AI_PROVIDER_DEFAULT_BASE_URLS.openrouter,
		defaultModel: "openai/gpt-4.1",
	},
	{
		value: "mistral",
		label: "Mistral AI",
		keywords: ["mistral", "magistral"],
		defaultBaseURL: AI_PROVIDER_DEFAULT_BASE_URLS.mistral,
		defaultModel: "mistral-large-latest",
	},
	{
		value: "cohere",
		label: "Cohere",
		keywords: ["cohere", "command"],
		defaultBaseURL: AI_PROVIDER_DEFAULT_BASE_URLS.cohere,
		defaultModel: "command-a-03-2025",
	},
	{
		value: "xai",
		label: "xAI Grok",
		keywords: ["xai", "grok"],
		defaultBaseURL: AI_PROVIDER_DEFAULT_BASE_URLS.xai,
		defaultModel: "grok-4",
	},
	{
		value: "groq",
		label: "Groq",
		keywords: ["groq", "llama"],
		defaultBaseURL: AI_PROVIDER_DEFAULT_BASE_URLS.groq,
		defaultModel: "llama-3.3-70b-versatile",
	},
	{
		value: "deepseek",
		label: "DeepSeek",
		keywords: ["deepseek"],
		defaultBaseURL: AI_PROVIDER_DEFAULT_BASE_URLS.deepseek,
		defaultModel: "deepseek-chat",
	},
	{
		value: "togetherai",
		label: "Together.ai",
		keywords: ["together", "togetherai", "llama"],
		defaultBaseURL: AI_PROVIDER_DEFAULT_BASE_URLS.togetherai,
		defaultModel: "meta-llama/Meta-Llama-3.3-70B-Instruct-Turbo",
	},
	{
		value: "fireworks",
		label: "Fireworks",
		keywords: ["fireworks", "llama", "deepseek"],
		defaultBaseURL: AI_PROVIDER_DEFAULT_BASE_URLS.fireworks,
		defaultModel: "accounts/fireworks/models/llama-v3p3-70b-instruct",
	},
	{
		value: "cerebras",
		label: "Cerebras",
		keywords: ["cerebras", "llama"],
		defaultBaseURL: AI_PROVIDER_DEFAULT_BASE_URLS.cerebras,
		defaultModel: "llama3.3-70b",
	},
	{
		value: "perplexity",
		label: "Perplexity",
		keywords: ["perplexity", "sonar"],
		defaultBaseURL: AI_PROVIDER_DEFAULT_BASE_URLS.perplexity,
		defaultModel: "sonar-pro",
	},
	{
		value: "ollama",
		label: "Ollama",
		keywords: ["ollama", "cloud"],
		defaultBaseURL: AI_PROVIDER_DEFAULT_BASE_URLS.ollama,
		defaultModel: "llama3.1",
	},
	{
		value: "openai-compatible",
		label: "OpenAI-compatible",
		keywords: ["compatible", "custom", "gateway"],
		defaultBaseURL: AI_PROVIDER_DEFAULT_BASE_URLS["openai-compatible"],
		defaultModel: "",
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

type TestResult = { testStatus: string; testError: string | null };

/**
 * What Test says after it runs: "Connected · 420 ms", with the round trip measured in the browser, or the provider's
 * own error so it can be fixed here.
 */
export function describeTest(result: TestResult, milliseconds: number, labels: { connected: string; failed: string }) {
	if (result.testStatus === "success")
		return { ok: true, label: `${labels.connected} · ${Math.round(milliseconds)} ms`, error: null };
	return { ok: false, label: labels.failed, error: result.testError?.trim() || null };
}
