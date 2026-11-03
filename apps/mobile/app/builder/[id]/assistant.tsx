import { Stack, useLocalSearchParams } from "expo-router";
import { AssistantScreen } from "@/features/assistant/assistant-screen";

type Params = { id: string; thread?: string; ask?: string; draft?: string; prepare?: string; applicationId?: string };

/** `?thread=` opens a conversation, `?ask=` sends, `?draft=` prefills, `?prepare=1` offers next-step starters. */
export default function AssistantRoute() {
	const { id, thread, ask, draft, prepare, applicationId } = useLocalSearchParams<Params>();
	return (
		<>
			<Stack.Screen options={{ headerShown: false }} />
			<AssistantScreen
				resumeId={id}
				threadId={thread}
				ask={ask}
				draft={draft}
				prepare={prepare === "1"}
				applicationId={applicationId}
			/>
		</>
	);
}
