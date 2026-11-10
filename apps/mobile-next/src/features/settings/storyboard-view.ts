import type { Provider } from "./providers";
// What the boards draw on A4 and S1–S5 that the storyboard fixture doesn't carry (reported fixture gaps): the short
// username, the app version, the UK locale name, the notice period and S5's unreachable Ollama provider. Used only
// with the fake data backend; a real account shows its own values.
import { useDataBackend } from "@/data";

export type StoryboardView = {
	username: string;
	version: string;
	language: string;
	noticePeriod: string;
	extraProviders: Provider[];
};

const at = new Date("2026-11-08T09:00:00.000Z");

const ollama: Provider = {
	id: "ollama-mac",
	managed: false,
	label: "Ollama on my Mac",
	provider: "ollama",
	model: "llama3.1",
	fastModel: null,
	capableModel: null,
	baseURL: "http://localhost:11434",
	enabled: true,
	isDefault: false,
	testStatus: "failure",
	testError: "fetch failed",
	testErrorKind: "network",
	apiKeyPreview: "",
	apiKeyFingerprint: "storyboard-ollama",
	recipientVersion: "0".repeat(64),
	lastTestedAt: at,
	lastUsedAt: null,
	createdAt: at,
	updatedAt: at,
};

export function useStoryboardView(): StoryboardView | null {
	const { backend } = useDataBackend();
	if (backend.kind !== "fake") return null;
	return {
		username: "alex",
		version: "6.1.0",
		language: "English (UK)",
		noticePeriod: "1 month",
		extraProviders: [ollama],
	};
}
