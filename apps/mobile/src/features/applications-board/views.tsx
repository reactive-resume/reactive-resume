import type { ApplicationsView } from "@/routes";
import type { ReactNode } from "react";
import { useLingui } from "@lingui/react/macro";
import { useLocalSearchParams, useRouter, Stack } from "expo-router";
import { useState } from "react";
import { View } from "react-native";
import { SafeAreaInsetsContext, SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import { useApplicationSearch } from "./search";
import { CollectionHeader } from "@/components/collection-header";
import { AddApplicationSheet } from "@/features/applications/add-sheet";
import { LaneNotice } from "@/features/applications/lane-notice";
import { LaneSettings } from "@/features/applications/lane-settings";
import { routes } from "@/routes";
import { Segmented, IconButton, useTheme } from "@/ui";

type ApplicationsViewFrameProps = {
	current: ApplicationsView;
	children: ReactNode;
	search?: { value: string; onChangeText: (value: string) => void; disabled?: boolean };
	/** The List view disables Save job while a bulk action is running. */
	addDisabled?: boolean;
};

/**
 * The List / Board / Calendar / Insights switch above each Applications view (mockup `viewTabs`), and the one owner
 * of the in-place Save job sheet. `?create=1` opens it on every view; closing clears it without leaving the view.
 */
export function ApplicationsViewFrame({ current, children, search, addDisabled }: ApplicationsViewFrameProps) {
	const router = useRouter();
	const shared = useApplicationSearch();
	const { create } = useLocalSearchParams<{ create?: string }>();
	const [adding, setAdding] = useState(false);
	const [managing, setManaging] = useState(false);
	// The one-shot ?create link opens Save job; closing it clears the link so it can't reopen.
	const addingOpen = adding || create === "1";
	const closeAdding = () => {
		setAdding(false);
		if (create === "1") router.setParams({ create: "" });
	};
	const { t } = useLingui();
	const { colors, motion, space } = useTheme();
	const insets = useSafeAreaInsets();
	return (
		<SafeAreaView edges={["top", "left", "right"]} style={{ flex: 1, backgroundColor: colors.bg }}>
			{/* Views swap in place with a crossfade: no back stack between them. Shared title stays above the view tabs. */}
			<Stack.Screen
				options={{ title: t`Applications`, animation: "fade", animationDuration: motion.d2, headerShown: false }}
			/>
			<View style={{ paddingHorizontal: space.s4, paddingTop: space.s4, paddingBottom: space.s1, gap: space.s3 }}>
				<CollectionHeader
					title={t`Applications`}
					searchLabel={t`Search applications`}
					placeholder={t`Role, company or contact`}
					{...(search ?? { value: shared.search, onChangeText: shared.setSearch })}
					actions={
						<View style={{ flexDirection: "row" }}>
							<IconButton icon="sliders-horizontal" label={t`Manage lanes`} onPress={() => setManaging(true)} />
							<IconButton icon="plus" label={t`Save a job`} disabled={addDisabled} onPress={() => setAdding(true)} />
						</View>
					}
				/>
				<LaneNotice />
				<Segmented
					label={t`Application views`}
					value={current}
					options={[
						{ value: "list", label: t`List` },
						{ value: "board", label: t`Board` },
						{ value: "calendar", label: t`Calendar` },
						{ value: "insights", label: t`Insights` },
					]}
					onChange={(view) => {
						if (view !== current) router.replace(routes.applications(view));
					}}
				/>
			</View>
			<SafeAreaInsetsContext value={{ ...insets, top: 0, left: 0, right: 0 }}>
				<View style={{ flex: 1 }}>{children}</View>
			</SafeAreaInsetsContext>
			<LaneSettings open={managing} onClose={() => setManaging(false)} />
			{addingOpen && <AddApplicationSheet onClose={closeAdding} />}
		</SafeAreaView>
	);
}
