import { t } from "@lingui/core/macro";
import { useLingui } from "@lingui/react";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useState } from "react";
import { View } from "react-native";
import { useDocumentId, DocumentState } from "../share/document";
import { useResumeVersions, useVersionActions } from "@/data";
import { now, timeZone } from "@/data/clock";
import { STORYBOARD } from "@/dev/storyboard/harness";
import {
	PushScreen,
	PageSubtitle,
	Button,
	Dialog,
	ListRow,
	SectionHeading,
	Text,
	TextField,
	useTheme,
	type ColorToken,
	BottomSheet,
	haptic,
} from "@/ui";

/** The dot before a version: what made it (B15). Named and sent versions stand out alike ("Sent to Lumen · named"). */
const dotColor: Partial<Record<string, ColorToken>> = {
	auto: "stSaved",
	ai: "infoText",
	named: "stApplied",
	sent: "stApplied",
};

export function VersionsScreen() {
	const { colors } = useTheme();
	const { i18n } = useLingui();
	const zone = timeZone();
	// The app writes dates day first ("3 November"), as the storyboard and the other screens do.
	const dateLocale = i18n.locale.startsWith("en") ? "en-GB" : i18n.locale;
	const day = (date: Date) => date.toLocaleDateString("en-CA", { timeZone: zone });
	const id = useDocumentId();
	const router = useRouter();
	const query = useResumeVersions(id);
	const versions = useVersionActions();
	const [naming, setNaming] = useState(false);
	const [name, setName] = useState("");
	// A named version's actions (long-press; the board draws its row with a caret, not ···), its rename and its delete.
	const [actions, setActions] = useState<{ id: string; name: string } | null>(null);
	const [renaming, setRenaming] = useState<{ id: string; name: string } | null>(null);
	const [deleting, setDeleting] = useState<{ id: string; name: string } | null>(null);
	// Storyboard flows reach "Only one version so far." with `preset=one`.
	const { preset } = useLocalSearchParams<{ preset?: string }>();
	const saveName = () => {
		const trimmed = name.trim();
		if (!trimmed) return;
		setNaming(false);
		setName("");
		void versions.nameResume({ resumeId: id, name: trimmed }).then(() => void query.refetch());
	};
	const days = STORYBOARD && preset === "one" ? [] : (query.data ?? []);
	const rename = () => {
		const target = renaming;
		const trimmed = target ? name.trim() : "";
		setRenaming(null);
		if (!target || !trimmed) return;
		void versions.renameResume({ resumeId: id, versionId: target.id, name: trimmed }).then(() => void query.refetch());
	};
	const sameDay = (a: number, b: number) => {
		const x = days[a];
		const y = days[b];
		return !!x && !!y && day(x.createdAt) === day(y.createdAt);
	};
	return (
		<PushScreen
			title={t`Versions`}
			backLabel={t`Back to Share`}
			subtitle={<PageSubtitle status>{t`Every editing session is kept.`}</PageSubtitle>}
			barEnd={<Button label={t`Name this version`} tone="accentGhost" size="sm" onPress={() => setNaming(true)} />}
			overlay={
				<>
					{actions ? (
						<BottomSheet title={actions.name} height={240} onClose={() => setActions(null)}>
							<ListRow
								title={t`Rename…`}
								top
								onPress={() => {
									setName(actions.name);
									setRenaming(actions);
									setActions(null);
								}}
							/>
							<ListRow
								title={t`Delete…`}
								danger
								last
								onPress={() => {
									setDeleting(actions);
									setActions(null);
								}}
							/>
						</BottomSheet>
					) : null}
					<Dialog
						open={!!renaming}
						onClose={() => setRenaming(null)}
						title={t`Rename version`}
						actions={[
							{ label: t`Save`, tone: "primary", onPress: rename },
							{ label: t`Cancel`, tone: "secondary", onPress: () => setRenaming(null) },
						]}
					>
						<TextField
							label={t`Name`}
							value={name}
							onChangeText={setName}
							maxLength={80}
							autoFocus
							testID="version-name"
						/>
					</Dialog>
					<Dialog
						open={!!deleting}
						onClose={() => setDeleting(null)}
						title={t`Delete “${deleting?.name ?? ""}”?`}
						message={t`The version is deleted. The resume as it is now doesn't change.`}
						actions={[
							{
								label: t`Delete permanently`,
								tone: "danger",
								onPress: () => {
									const target = deleting;
									setDeleting(null);
									if (!target) return;
									haptic("light");
									void versions.deleteResume({ resumeId: id, versionId: target.id }).then(() => void query.refetch());
								},
							},
							{ label: t`Cancel`, tone: "secondary", onPress: () => setDeleting(null) },
						]}
					/>
					<Dialog
						open={naming}
						onClose={() => setNaming(false)}
						title={t`Name this version`}
						actions={[
							{ label: t`Save`, tone: "primary", onPress: saveName },
							{ label: t`Cancel`, tone: "secondary", onPress: () => setNaming(false) },
						]}
					>
						<TextField label={t`Name`} value={name} onChangeText={setName} maxLength={80} autoFocus />
					</Dialog>
				</>
			}
		>
			<View style={{ marginTop: 20 }}>
				<ListRow
					title={t`Now`}
					secondary={t`The resume as it is`}
					leading={<View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: colors.accent }} />}
					last
					onPress={() => router.push(`/builder/${id}/preview`)}
				/>
			</View>
			<DocumentState loading={query.isPending} error={query.isError} retry={() => void query.refetch()} height={270} />
			{query.data && days.length === 0 && (
				<Text style={{ margin: 24 }}>{t`Only one version so far. Every editing session adds one automatically.`}</Text>
			)}
			{days.map((version, index) => (
				<View key={version.id}>
					{!sameDay(index - 1, index) ? (
						<SectionHeading
							first
							title={
								day(version.createdAt) === day(now())
									? t`Today`
									: version.createdAt.toLocaleDateString(dateLocale, { day: "numeric", month: "long", timeZone: zone })
							}
						/>
					) : null}
					<ListRow
						title={
							version.name ??
							(version.kind === "ai"
								? t`AI edit`
								: version.kind === "before-restore" || (version.kind as string) === "restore"
									? t`Before restore`
									: t`Editing session`)
						}
						secondary={`${version.createdAt.toLocaleTimeString(i18n.locale, { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: zone })}${version.kind === "ai" ? t` · from the assistant` : version.name ? t` · named` : ""}`}
						leading={
							<View
								style={{
									width: 8,
									height: 8,
									borderRadius: 4,
									backgroundColor: colors[dotColor[version.kind] ?? "line2"],
								}}
							/>
						}
						trailing="caret"
						{...(version.kind === "named"
							? { onLongPress: () => setActions({ id: version.id, name: version.name ?? "" }) }
							: {})}
						last={!sameDay(index, index + 1)}
						boxHidden={!sameDay(index, index + 1)}
						onPress={() =>
							router.push({
								pathname: "/builder/[id]/versions/[version]",
								params: { id, version: version.id, name: version.name ?? "" },
							})
						}
					/>
				</View>
			))}
		</PushScreen>
	);
}
