import type { ComboboxOption } from "@/components/ui/combobox";
import type { AIProvider } from "@reactive-resume/ai/types";
import { z } from "zod";
import { AI_PROVIDER_DEFAULT_BASE_URLS, AI_PROVIDER_DEFAULT_MODELS } from "@reactive-resume/ai/defaults";

export const modelsDevProviderIds: Record<AIProvider, string | null> = {
	openai: "openai",
	anthropic: "anthropic",
	gemini: "google",
	"vercel-ai-gateway": "vercel",
	openrouter: "openrouter",
	mistral: "mistral",
	cohere: "cohere",
	xai: "xai",
	groq: "groq",
	deepseek: "deepseek",
	togetherai: "togetherai",
	fireworks: "fireworks-ai",
	cerebras: "cerebras",
	perplexity: "perplexity",
	runcrate: null,
	ollama: "ollama-cloud",
	"openai-compatible": null,
};

const catalogProviderSchema = z.object({ models: z.record(z.string(), z.unknown()) });
const catalogModelSchema = z.object({
	id: z.string().min(1),
	name: z.string().min(1),
	release_date: z.string().optional(),
	status: z.string().optional(),
	modalities: z.object({ input: z.array(z.string()), output: z.array(z.string()) }),
	limit: z.object({ context: z.number().positive(), output: z.number().positive() }),
});

/** Public, optional suggestions. Provider-specific IDs must be kept intact, including gateway prefixes. */
export async function loadModelSuggestions(signal: AbortSignal) {
	const response = await fetch("https://models.dev/api.json", {
		signal: AbortSignal.any([signal, AbortSignal.timeout(10_000)]),
		credentials: "omit",
		referrerPolicy: "no-referrer",
	});
	if (!response.ok) throw new Error("Model suggestions are unavailable");
	const catalog = z.record(z.string(), z.unknown()).parse(await response.json());
	return Object.fromEntries<z.infer<typeof catalogModelSchema>[]>(
		Object.values(modelsDevProviderIds).flatMap((id) => {
			if (!id) return [];
			const provider = catalogProviderSchema.safeParse(catalog[id]);
			const models = provider.success
				? Object.values(provider.data.models).flatMap((entry) => {
						const model = catalogModelSchema.safeParse(entry);
						if (
							!model.success ||
							model.data.status === "deprecated" ||
							!model.data.modalities.input.includes("text") ||
							!model.data.modalities.output.includes("text")
						)
							return [];
						return [model.data];
					})
				: [];
			models.sort((a, b) => (b.release_date ?? "").localeCompare(a.release_date ?? "") || a.name.localeCompare(b.name));
			return [[id, models]];
		}),
	);
}

export type AIProviderOption = ComboboxOption<AIProvider> & { defaultBaseURL: string; defaultModel: string };

// Provider labels are brand names and stay untranslated on purpose, so every locale shows the
// vendor's own spelling instead of a literal translation (e.g. "Google Gemini", not "谷歌双子座").
export const providerOptions: AIProviderOption[] = [
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
		value: "runcrate",
		label: "Runcrate",
		keywords: ["runcrate", "deepseek", "qwen", "open"],
		defaultBaseURL: AI_PROVIDER_DEFAULT_BASE_URLS.runcrate,
		defaultModel: AI_PROVIDER_DEFAULT_MODELS.runcrate,
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
