import type { AIProvider } from "@reactive-resume/ai/types";
import { AI_PROVIDER_DEFAULT_BASE_URLS } from "@reactive-resume/ai/types";

type AiProviderCapabilityInput = {
	provider: AIProvider;
	model: string;
	baseURL?: string | null;
};

function normalizeDirectBaseUrl(baseURL: string) {
	try {
		const parsed = new URL(baseURL);
		if (parsed.search || parsed.hash || parsed.username || parsed.password) return null;
		return parsed.toString().replace(/\/+$/, "");
	} catch {
		return null;
	}
}

export function isDirectOpenAIProvider(input: Pick<AiProviderCapabilityInput, "provider" | "baseURL">) {
	return input.provider === "openai" && isDirectProvider(input);
}

function isDirectProvider(input: Pick<AiProviderCapabilityInput, "provider" | "baseURL">) {
	if (!input.baseURL?.trim()) return true;

	const baseURL = normalizeDirectBaseUrl(input.baseURL);
	if (!baseURL) return false;

	return baseURL === normalizeDirectBaseUrl(AI_PROVIDER_DEFAULT_BASE_URLS[input.provider]);
}

const OPENAI_WEB_SEARCH_RESPONSES_MODEL_IDS = new Set([
	// Snapshot from official OpenAI model docs on 2026-05-13. These model pages list Responses
	// API support and Responses web search support. Most are also explicit in installed
	// @ai-sdk/openai OpenAIResponsesModelId; gpt-5.5-pro is accepted through the SDK's string
	// model ID fallback and openai.responses("gpt-5.5-pro") runtime construction.
	// https://developers.openai.com/api/docs/models/gpt-5.5-pro
	"gpt-5.5-pro",
	// https://developers.openai.com/api/docs/models/gpt-5.5
	"gpt-5.5",
	// https://developers.openai.com/api/docs/models/gpt-5.4
	"gpt-5.4",
	// https://developers.openai.com/api/docs/models/gpt-5.4-mini
	"gpt-5.4-mini",
	// https://developers.openai.com/api/docs/models/gpt-5.4-nano
	"gpt-5.4-nano",
	// https://developers.openai.com/api/docs/models/gpt-5.4-pro
	"gpt-5.4-pro",
	// https://developers.openai.com/api/docs/models/gpt-5
	"gpt-5",
	// https://developers.openai.com/api/docs/models/gpt-5-mini
	"gpt-5-mini",
	// https://developers.openai.com/api/docs/models/gpt-5-nano
	"gpt-5-nano",
	// https://developers.openai.com/api/docs/models/gpt-4.1
	"gpt-4.1",
	// https://developers.openai.com/api/docs/models/gpt-4.1-mini
	"gpt-4.1-mini",
	// https://developers.openai.com/api/docs/guides/tools-web-search?api-mode=responses
	"o4-mini",
	// Published snapshots also listed by the installed OpenAI Responses SDK. An arbitrary
	// dated suffix is not proof that a model exists or supports native search.
	"gpt-5-2025-08-07",
	"gpt-5-mini-2025-08-07",
	"gpt-5-nano-2025-08-07",
	"gpt-4.1-2025-04-14",
	"gpt-4.1-mini-2025-04-14",
	"o4-mini-2025-04-16",
	"gpt-5.4-2026-03-05",
	"gpt-5.4-pro-2026-03-05",
	"gpt-5.4-mini-2026-03-17",
	"gpt-5.4-nano-2026-03-17",
	"gpt-5.5-2026-04-23",
]);

export function supportsOpenAIWebSearch(model: string) {
	const normalized = model.trim().toLowerCase();
	if (!normalized || normalized.includes("codex")) return false;

	return OPENAI_WEB_SEARCH_RESPONSES_MODEL_IDS.has(normalized);
}

export function supportsProviderNativeWebSearch(provider: AiProviderCapabilityInput) {
	return nativeWebSearchToolName(provider) !== null;
}

/** Documented direct endpoints only; gateways and unknown model IDs never inherit native tools. */
export function nativeWebSearchToolName(input: AiProviderCapabilityInput): "web_search" | "google_search" | null {
	if (!isDirectProvider(input)) return null;
	if (input.provider === "openai" && supportsOpenAIWebSearch(input.model)) return "web_search";
	// Basic web search also works alongside client document tools. Organization search must be enabled.
	// https://platform.claude.com/docs/en/agents-and-tools/tool-use/web-search-tool
	if (input.provider === "anthropic" && ["claude-sonnet-4-6", "claude-opus-4-6"].includes(input.model)) {
		return "web_search";
	}
	// Gemini 2.x cannot combine grounding and custom document tools; the installed SDK drops the latter.
	// Gemini 3 combination support is preview: https://ai.google.dev/gemini-api/docs/tool-combination
	if (input.provider === "gemini" && ["gemini-3.8-flash", "gemini-3.1-pro-preview"].includes(input.model)) {
		return "google_search";
	}
	return null;
}
