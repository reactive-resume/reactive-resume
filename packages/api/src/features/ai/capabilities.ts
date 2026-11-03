import type { AIProvider } from "@reactive-resume/ai/types";
import { isDirectAiProvider } from "@reactive-resume/ai/types";

type AiProviderCapabilityInput = {
	provider: AIProvider;
	baseURL?: string | null;
};

export function isDirectOpenAIProvider(input: Pick<AiProviderCapabilityInput, "provider" | "baseURL">) {
	return input.provider === "openai" && isDirectAiProvider(input);
}
