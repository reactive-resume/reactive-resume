import { useLingui } from "@lingui/react/macro";
import { useNetworkState } from "expo-network";
import { ScrollView, View } from "react-native";
import { useShareDocument } from "./document";
import { LinkTab } from "./link";
import { useSession } from "@/auth/session";
import { Banner, Skeleton, useTheme } from "@/ui";

/** The builder's Share pane: publishing, the web page and who sees what. */
export function SharePane({ id }: { id: string }) {
	const { t } = useLingui();
	const { space, size, colors } = useTheme();
	const draft = useShareDocument(id);
	const session = useSession();
	const network = useNetworkState();
	const offline = network.isConnected === false || network.isInternetReachable === false;

	return (
		<ScrollView
			keyboardShouldPersistTaps="handled"
			style={{ backgroundColor: colors.bg }}
			contentContainerStyle={{
				padding: space.s4,
				gap: space.s4,
				width: "100%",
				maxWidth: size.sheetShare,
				alignSelf: "center",
			}}
		>
			{offline && <Banner tone="info" message={t`You're offline. Sharing needs a connection.`} />}
			{session.status !== "signed-in" && <Banner tone="warn" message={t`Sign in to continue.`} />}
			{draft.document ? (
				<LinkTab key={id} resume={draft.document} offline={offline} />
			) : (
				<View>
					<Skeleton height={space.s12} />
				</View>
			)}
		</ScrollView>
	);
}
