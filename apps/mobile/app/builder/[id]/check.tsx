import { useLocalSearchParams } from "expo-router";
import { useSession } from "@/auth/session";
import { CheckScreen } from "@/features/check/screen";

export default function CheckRoute() {
	const { id, tab, applicationId } = useLocalSearchParams<{ id: string; tab?: string; applicationId?: string }>();
	const session = useSession();
	return (
		<CheckScreen
			key={`${id}:${session.server}:${session.status}:${tab}:${applicationId}`}
			id={id}
			applicationId={applicationId}
			initialTab={tab === "match" || tab === "writing" ? tab : "issues"}
		/>
	);
}
