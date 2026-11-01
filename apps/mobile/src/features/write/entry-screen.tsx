import type { WriteSection } from "./model";
import type { ReactNode } from "react";
import { useLingui } from "@lingui/react/macro";
import { useRouter, Stack } from "expo-router";
import { useMemo, useState } from "react";
import { View } from "react-native";
import { KeyboardAwareScrollView } from "react-native-keyboard-controller";
import { EntryFields } from "./entry-fields";
import { EntrySheet } from "./entry-sheet";
import { DRAFT_HINTS } from "./fields";
import { consumeFocus, useEntry, useEntryWriter, useSectionTitle, useWriteData } from "./hooks";
import { describeEntry, getSectionKind, getSectionType, isDraftEntry, PRIMARY_FIELD } from "./model";
import { RichTextField, RichTextToolbar } from "./rich-text-field";
import { useIsResumeLocked, useResumeStore } from "@/draft";
import { Banner, EmptyState, IconButton, Text, useTheme } from "@/ui";
import { useKeyboardScrollSpace } from "@/ui/keyboard";

type EditorScreenProps = { title: string; backTitle?: string | undefined; right?: ReactNode; children: ReactNode };

/** A full-screen editor: scrolls above the keyboard and docks the rich-text toolbar. */
export function EditorScreen({ title, backTitle, right, children }: EditorScreenProps) {
	const { colors, size, space } = useTheme();
	const keyboardSpace = useKeyboardScrollSpace();
	const ready = useResumeStore((state) => state.document !== null);
	const locked = useIsResumeLocked();
	const { t } = useLingui();
	return (
		<View style={{ flex: 1, backgroundColor: colors.bg }}>
			<Stack.Screen
				options={{
					title,
					...(backTitle ? { headerBackTitle: backTitle } : {}),
					...(right ? { headerRight: () => right } : {}),
				}}
			/>
			{!ready ? (
				<EmptyState icon="hourglass" title={t`Loading…`} />
			) : (
				<KeyboardAwareScrollView
					extraKeyboardSpace={keyboardSpace}
					keyboardShouldPersistTaps="handled"
					bottomOffset={size.hit + space.s4}
					contentContainerStyle={{ padding: space.s4, gap: space.s4, paddingBottom: size.hit * 2 }}
				>
					{locked ? <Banner tone="info" icon="lock" message={t`Locked. Unlock to edit.`} /> : null}
					{children}
				</KeyboardAwareScrollView>
			)}
			<RichTextToolbar />
		</View>
	);
}

type EntryScreenProps = { resumeId: string; sectionId: string; entryId: string; focusField?: string | undefined };

/** One entry, full screen: its fields, saved as you type. Deleting is immediate, with Undo in the toast. */
export function EntryScreen({ resumeId, sectionId, entryId, focusField }: EntryScreenProps) {
	const router = useRouter();
	const { t, i18n } = useLingui();
	const type = useWriteData((data) => getSectionType(data, sectionId) ?? null, null);
	const section = useMemo<WriteSection | null>(
		() => (type ? { id: sectionId, kind: getSectionKind(sectionId), type } : null),
		[sectionId, type],
	);
	const sectionTitle = useSectionTitle(section);
	const entry = useEntry(sectionId, entryId);
	const write = useEntryWriter(sectionId, entryId);
	const locked = useIsResumeLocked();
	const locale = useWriteData((data) => data.metadata.page.locale, "en-US");
	const dateFormat = useWriteData((data) => data.metadata.page.dateFormat ?? null, null);
	const [autoFocus] = useState(() => consumeFocus(entryId));
	const [options, setOptions] = useState(false);
	const loaded = useResumeStore((state) => state.document !== null);

	if (loaded && (!section || !entry))
		return (
			<EditorScreen title={t`Entry`}>
				<EmptyState icon="info" title={t`This entry was deleted.`} action={{ label: t`Back`, onPress: router.back }} />
			</EditorScreen>
		);
	if (!section || !entry) return <EditorScreen title={t`Entry`}>{null}</EditorScreen>;

	const { title } = describeEntry(section.type, entry);
	const primary = PRIMARY_FIELD[section.type];
	const hint = isDraftEntry(section.type, entry) && primary ? DRAFT_HINTS[primary] : undefined;

	return (
		<EditorScreen
			title={title || t`Untitled`}
			backTitle={sectionTitle}
			right={locked ? null : <IconButton icon="dots-three" label={t`Entry options`} onPress={() => setOptions(true)} />}
		>
			{hint ? (
				<Text variant="caption" color="ink3">
					{i18n._(hint)}
				</Text>
			) : null}
			<EntryFields
				type={section.type}
				entry={entry}
				write={write}
				page={{ locale, dateFormat: dateFormat ?? undefined }}
				disabled={locked}
				autoFocus={autoFocus}
				focusField={focusField}
			/>
			<EntrySheet
				resumeId={resumeId}
				section={section}
				entryId={entryId}
				open={options}
				onClose={() => setOptions(false)}
				onGone={() => router.back()}
			/>
		</EditorScreen>
	);
}

/** The summary: one rich text, with the guidance web gives, and Improve. */
type SummaryScreenProps = { autoFocus?: boolean | undefined };

export function SummaryScreen({ autoFocus }: SummaryScreenProps) {
	const { t } = useLingui();
	const content = useWriteData((data) => data.summary.content, "");
	const title = useSectionTitle({ id: "summary", kind: "summary", type: "summary" });
	const locked = useIsResumeLocked();
	const update = useResumeStore((state) => state.update);
	const loaded = useResumeStore((state) => state.document !== null);

	return (
		<EditorScreen title={title}>
			{loaded ? (
				<RichTextField
					label={t`Summary`}
					value={content}
					disabled={locked}
					hint={t`2–3 sentences reads best`}
					autoFocus={!locked && (autoFocus || !content)}
					onChange={(html, options) =>
						update(
							(draft) => {
								draft.summary.content = html;
							},
							{ coalesceKey: "summary.content", ...options },
						)
					}
				/>
			) : null}
		</EditorScreen>
	);
}
