// What the boards draw on A4 and S1–S4 that the storyboard fixture doesn't carry (reported fixture gaps): the short
// username, the app version, the UK locale name and the notice period. Used only with the fake data backend; a real
// account shows its own values.
import { useDataBackend } from "@/data";

export type StoryboardView = {
	username: string;
	version: string;
	language: string;
	noticePeriod: string;
};

export function useStoryboardView(): StoryboardView | null {
	const { backend } = useDataBackend();
	if (backend.kind !== "fake") return null;
	return {
		username: "alex",
		version: "6.1.0",
		language: "English (UK)",
		noticePeriod: "1 month",
	};
}
