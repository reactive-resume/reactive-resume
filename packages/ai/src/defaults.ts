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
	runcrate: "deepseek-ai/DeepSeek-V4.1-Flash",
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
	runcrate: "https://api.runcrate.ai/v1",
	ollama: "https://ollama.com/api",
	"openai-compatible": "",
};
