import type { ReactNode } from "react";
// Storyboard backdrops (lead's decision, FIDELITY-LOG.md): the boards draw a simplified stub of the screen under a
// sheet or dialog (bar and title only, or the list shifted by a couple of dp), not the real screen. In storyboard
// captures only, the scenario presents the sheet over this route instead, which draws exactly what that screen's
// layout dump lists outside the sheet, with the design system's components at the dump's positions. The real app
// always shows the real screen underneath. Inert without EXPO_PUBLIC_STORYBOARD=1.
import { useLocalSearchParams } from "expo-router";
import { View } from "react-native";
import { STORYBOARD } from "./harness";
import { SignOutDialog } from "@/features/settings/SignOutDialog";
import { storyboardSignOut } from "@/features/settings/storyboard";
import { DocThumb, ListRow, PageSubtitle, PushScreen, Screen, SectionHeading, Text, layout } from "@/ui";

/** A modal's bar (close) and page title, nothing else: S7 over D4, S8 over S1. */
const titled = (title: string, overlay?: ReactNode) => (
	<PushScreen title={title} back="close" overlay={overlay}>
		{null}
	</PushScreen>
);

/** J6's bar (back) and page title, with its subtitle when the board draws one: J7 and J8 over Lumen, J9 over Parcel. */
const detailStub = (title: string, subtitle?: string) => (
	<PushScreen title={title} {...(subtitle ? { subtitle: <PageSubtitle status>{subtitle}</PageSubtitle> } : {})}>
		{null}
	</PushScreen>
);

/** D1's Resumes list without the header, 2 dp lower than D1 draws it (D2, D3). */
const resumes = [
	{ title: "Product designer", secondary: "Edited 2 h ago · Public" },
	{ title: "Product designer — Lumen", secondary: "Edited yesterday · For Lumen" },
	{ title: "Design lead", secondary: "Edited 3 Oct" },
];
const libraryStub = () => (
	<Screen>
		{/* The heading's line box at 122.5: 47 status area + 55.5, less the first heading's 20 dp top padding. */}
		<View style={{ paddingTop: 122.5 - layout.sectionGapTopFirst }}>
			<SectionHeading title="Resumes" first />
			{resumes.map((row, index) => (
				<ListRow
					key={row.title}
					wrapTitle
					wrapSecondary
					title={row.title}
					secondary={row.secondary}
					leading={<DocThumb />}
					trailing="caret"
					last={index === resumes.length - 1}
				/>
			))}
		</View>
	</Screen>
);

/** C1's title and subtitle, 3 and 6 dp higher than C1 draws them, no avatar (C7). */
const careerStub = () => (
	<Screen>
		<Text variant="rootTitle" style={{ position: "absolute", top: 54.5, start: layout.screenMargin }}>
			Career
		</Text>
		<Text variant="ui" color="ink3" style={{ position: "absolute", top: 94.5, start: layout.screenMargin }}>
			Your coach, and what it knows about you.
		</Text>
	</Screen>
);

const signOut = (variant: string) => {
	const preset = storyboardSignOut(variant);
	return titled(
		"Settings",
		<SignOutDialog
			open
			counts={preset.counts}
			initial={preset.initial}
			offline={preset.offline}
			conflicts={0}
			onClose={() => {}}
			onSignedOut={() => {}}
		/>,
	);
};

const backdrops: Record<string, (variant: string | undefined) => ReactNode> = {
	"S7-FirstSend": () => titled("Import a resume"),
	"S8-SignOut": (variant) => signOut(variant ?? "offline"),
	"D2-Actions": libraryStub,
	"D3-New": libraryStub,
	"C7-Schedule": careerStub,
	"J7-Stage": () => detailStub("Lumen"),
	"J8-Interview": () => detailStub("Lumen"),
	"J9-Close": () => detailStub("Parcel & Co.", "Product designer · Lisbon"),
};

/** `/storyboard-backdrop/<ID>[?variant=…]`; scenarios push the sheet's route after it. */
export function StoryboardBackdrop() {
	const { id, variant } = useLocalSearchParams<{ id: string; variant?: string }>();
	if (!STORYBOARD) return null;
	return <>{backdrops[id]?.(variant) ?? null}</>;
}

/** Scenario hrefs: the backdrop, then the sheet or dialog. */
export const overBackdrop = (id: string, ...hrefs: string[]) => [`/storyboard-backdrop/${id}`, ...hrefs];
