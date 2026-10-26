import { useLingui } from "@lingui/react/macro";
import { useNetworkState } from "expo-network";
import { Stack, useRouter } from "expo-router";
import { useState } from "react";
import { ScrollView, View } from "react-native";
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";
import { useShareDocument } from "./document";
import { DownloadTab } from "./download";
import { useSession } from "@/auth/session";
import { DocumentMenu } from "@/features/document-menu";
import { HistoryPanel } from "@/features/history/history";
import { Banner, Button, Segmented, Skeleton, useTheme } from "@/ui";

type ExportScreenProps = { id: string; history?: boolean };
/** Download & history, over the builder. */
export function ExportScreen({ id, history = false }: ExportScreenProps) {
	const router = useRouter();
	const { t } = useLingui();
	const { space, colors, size } = useTheme();
	const draft = useShareDocument(id);
	const session = useSession();
	const network = useNetworkState();
	const offline = network.isConnected === false || network.isInternetReachable === false;
	const [tab, setTab] = useState<"download" | "history">(history ? "history" : "download");
	return (
		<SafeAreaProvider>
			<SafeAreaView edges={["bottom", "left", "right"]} style={{ flex: 1, backgroundColor: colors.bg }}>
				<Stack.Screen options={{ title: t`Download & history`, headerRight: () => <DocumentMenu id={id} /> }} />
				<View style={{ padding: space.s4, gap: space.s3 }}>
					<Segmented
						label={t`Download & history`}
						value={tab}
						onChange={setTab}
						options={[
							{ value: "download", label: t`Download` },
							{ value: "history", label: t`History` },
						]}
					/>
					{offline && tab !== "download" && (
						<Banner
							tone="info"
							message={t`You're offline. History needs a connection. Download PDF works on this device.`}
						/>
					)}
					{draft.document?.isLocked && (
						<Banner
							tone="warn"
							message={t`This document is locked. You can still download and name versions. Unlock to edit or restore.`}
						/>
					)}
					{session.status !== "signed-in" && <Banner tone="warn" message={t`Sign in to continue.`} />}
					{draft.status === "error" && (
						<Banner
							tone="danger"
							message={t`Changes couldn't be saved. Retry before continuing.`}
							action={{
								label: t`Retry`,
								onPress: () => (draft.document ? draft.retry() : void draft.open(id).catch(() => {})),
							}}
						/>
					)}
				</View>
				{draft.document ? (
					tab === "history" ? (
						<HistoryPanel resume={draft.document} offline={offline} />
					) : (
						<ScrollView
							keyboardShouldPersistTaps="handled"
							contentContainerStyle={{
								padding: space.s4,
								paddingTop: 0,
								gap: space.s4,
								width: "100%",
								maxWidth: size.sheetShare,
								alignSelf: "center",
							}}
						>
							<DownloadTab key={id} resume={draft.document} offline={offline} />
						</ScrollView>
					)
				) : (
					<View style={{ padding: space.s4 }}>
						<Skeleton height={space.s12} />
					</View>
				)}
				<View style={{ paddingHorizontal: space.s4 }}>
					<Button label={t`Close`} variant="ghost" onPress={() => router.back()} />
				</View>
			</SafeAreaView>
		</SafeAreaProvider>
	);
}
