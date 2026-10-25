import { useLingui } from "@lingui/react/macro";
import { useState } from "react";
import { useWindowDimensions } from "react-native";
import { Facts } from "./facts";
import { useCareerQueries } from "./hooks";
import { Preferences } from "./preferences";
import { LoadState } from "./shared";
import { Stories } from "./stories";
import { useSession } from "@/auth/session";
import { Screen, Segmented, Text } from "@/ui";

export function KnowledgeScreen() {
	const { t } = useLingui();
	const [tab, setTab] = useState("facts");
	const { fontScale } = useWindowDimensions();
	const session = useSession();
	const { facts, stories, profile } = useCareerQueries();
	const refresh = () => Promise.allSettled([facts.refetch(), stories.refetch(), profile.refetch()]);
	const intro = (
		<>
			<Text color="ink3">{t`Your facts, stories and preferences. Editing Knowledge sends nothing to an AI connection.`}</Text>
			<Segmented
				orientation={fontScale > 1.3 ? "vertical" : "horizontal"}
				label={t`Knowledge`}
				value={tab}
				onChange={setTab}
				options={[
					{ value: "facts", label: t`Facts` },
					{ value: "stories", label: t`Stories` },
					{ value: "preferences", label: t`Preferences` },
				]}
			/>
		</>
	);
	// Facts can run to hundreds, so that tab scrolls as a virtualized list with the intro as its header.
	if (tab === "facts")
		return (
			<Screen scroll={false} contentStyle={{ padding: 0 }}>
				<Facts key={session.server} onRefresh={refresh}>
					{intro}
				</Facts>
			</Screen>
		);
	return (
		<Screen onRefresh={refresh}>
			{intro}
			{tab === "stories" ? (
				<Stories key={session.server} />
			) : (
				<>
					<LoadState query={profile} />
					{profile.data ? <Preferences key={session.server} initial={profile.data} /> : null}
				</>
			)}
		</Screen>
	);
}
