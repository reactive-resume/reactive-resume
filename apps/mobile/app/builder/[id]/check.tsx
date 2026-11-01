import { useLocalSearchParams } from "expo-router";
import { useSession } from "@/auth/session";
import { CheckScreen } from "@/features/check/screen";

export default function CheckRoute() {
	const { id, tab } = useLocalSearchParams<{ id: string; tab?: string }>();
	const session = useSession();
	return (
		<CheckScreen
			key={`${id}:${session.server}:${session.status}`}
			id={id}
			initialTab={tab === "match" || tab === "writing" ? tab : "issues"}
		/>
	);
}
