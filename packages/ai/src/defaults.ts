import type { AIProvider } from "./types";

// New-provider suggestions only; never replace a saved or administrator-selected model.
// Prefer current, cost-efficient general-purpose models with tool support.
export const AI_PROVIDER_DEFAULT_MODELS: Record<AIProvider, string> = {
	openai: "gpt-6-luna",
	anthropic: "claude-haiku-5-5",
	gemini: "gemini-3.5-flash-lite",
	"vercel-ai-gateway": "openai/gpt-6-luna",
	openrouter: "anthropic/claude-haiku-5.5",
	mistral: "mistral-small-latest",
	cohere: "command-r7b-12-2024",
	xai: "grok-4.3",
	groq: "openai/gpt-oss-20b",
	deepseek: "deepseek-flash",
	togetherai: "Qwen/Qwen3.8-Flash",
	fireworks: "accounts/fireworks/models/deepseek-v4p1-flash-1017",
	cerebras: "qwen-3.8-27b",
	perplexity: "sonar",
	ollama: "gpt-oss:20b-cloud",
	"openai-compatible": "",
};

export const AI_PROVIDER_DEFAULT_BASE_URLS: Record<AIProvider, string> = {
	openai: "https://api.openai.com/v1",
	anthropic: "https://api.anthropic.com/v1",
	gemini: "https://generativelanguage.googleapis.com/v1beta",
	"vercel-ai-gateway": "https://ai-gateway.vercel.sh/v3/ai",
	openrouter: "https://openrouter.ai/api/v1",
	mistral: "https://api.mistral.ai/v1",
	cohere: "https://api.cohere.com/v2",
	xai: "https://api.x.ai/v1",
	groq: "https://api.groq.com/openai/v1",
	deepseek: "https://api.deepseek.com/v1",
	togetherai: "https://api.together.xyz/v1",
	fireworks: "https://api.fireworks.ai/inference/v1",
	cerebras: "https://api.cerebras.ai/v1",
	perplexity: "https://api.perplexity.ai",
	ollama: "https://ollama.com/api",
	"openai-compatible": "",
};

export type AIProviderSetupFields = { apiKey: string; model: string; baseURL: string };

export const AI_PROVIDER_KEY_URLS: Record<AIProvider, string> = {
	openai: "https://platform.openai.com/api-keys",
	anthropic: "https://platform.claude.com/settings/keys",
	gemini: "https://aistudio.google.com/apikey",
	"vercel-ai-gateway": "https://vercel.com/dashboard/ai-gateway",
	openrouter: "https://openrouter.ai/keys",
	mistral: "https://console.mistral.ai/api-keys",
	cohere: "https://dashboard.cohere.com/api-keys",
	xai: "https://console.x.ai/",
	groq: "https://console.groq.com/keys",
	deepseek: "https://platform.deepseek.com/api_keys",
	togetherai: "https://api.together.ai/settings/projects/~current/api-keys",
	fireworks: "https://app.fireworks.ai/settings/users/api-keys",
	cerebras: "https://cloud.cerebras.ai/platform",
	perplexity: "https://console.perplexity.ai/",
	ollama: "https://ollama.com/settings/keys",
	"openai-compatible": "",
};

/** Form syntax only; the server still enforces endpoint policy and saved-key protection. */
export function getAIProviderSetupProblem(
	provider: AIProvider,
	fields: AIProviderSetupFields,
	hasSavedKey = false,
): "baseURL" | "apiKey" | "model" | null {
	const baseURL = fields.baseURL.trim();
	if (!baseURL && provider === "openai-compatible") return "baseURL";
	if (baseURL) {
		try {
			const url = new URL(baseURL);
			if (url.protocol !== "https:" && url.protocol !== "http:") return "baseURL";
		} catch {
			return "baseURL";
		}
	}
	if (!hasSavedKey && provider !== "ollama" && !fields.apiKey.trim()) return "apiKey";
	if (!fields.model.trim()) return "model";
	return null;
}
