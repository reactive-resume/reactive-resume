import { t } from "@lingui/core/macro";
import { useRouter } from "expo-router";
import { useRef, useState } from "react";
import { TextInput, View } from "react-native";
import { splitBlocks, replaceBlockText } from "@reactive-resume/resume/proposals";
import { useDocumentId, useLetterDocument, DocumentState } from "../builder/share/document";
import { LetterDocument } from "../builder/shared/document";
import { useLetterStore, letterFieldFocus, useApplication, useApplications, useDocuments, useResume } from "@/data";
import { useCaptureStore } from "@/dev/storyboard/capture";
import { STORYBOARD } from "@/dev/storyboard/harness";
import {
	PushScreen,
	IconButton,
	Text,
	SectionHeading,
	ListRow,
	type as typeScale,
	useTheme,
	Touch,
	BottomSheet,
	Icon,
	TextLink,
	haptic,
	showToast,
} from "@/ui";

/** Locked, tapping the letter says how to unlock it (B19). */
const letterLockedNotice = () => showToast({ message: t`This letter is locked. Unlock it to make changes.` });

export function LetterScreen() {
	const id = useDocumentId();
	const router = useRouter();
	const query = useLetterDocument(id);
	const document = query.data;
	const store = useLetterStore();
	// The board draws no "Draft from the posting" link; storyboard captures leave it out.
	const capturing = useCaptureStore((s) => STORYBOARD && s.request !== null && s.ready !== s.request.nonce);
	const { colors } = useTheme();
	const visit = useRef(0);
	const [editing, setEditing] = useState<number>();
	// What is typed while a paragraph is open: the saved block is normalised (trimmed), which ate a space just typed.
	const [typed, setTyped] = useState("");
	const resume = useResume(document?.sourceResumeId ?? "");
	const application = useApplication(document?.sourceApplicationId ?? "");
	const ready = store.document?.id === id;
	// The Resume and Application pickers.
	const [picker, setPicker] = useState<"resume" | "application" | null>(null);
	const resumes = useDocuments();
	const applications = useApplications();
	const sent = !!application.data?.sentCoverLetterVersionId;
	// The board draws L1 without the sent line; storyboard captures leave it out.
	const sentLine = sent && !capturing;
	const pick = (field: "sourceResumeId" | "sourceApplicationId", value: string) => {
		setPicker(null);
		if (!ready || store.locked) {
			showToast({ message: t`Couldn't change the letter. Try again.` });
			return;
		}
		haptic("selection");
		store.update(
			(d) => {
				d[field] = value;
			},
			{ newStep: true },
		);
	};
	const draftFromPosting = () => {
		if (!document?.sourceResumeId) return;
		router.push({
			pathname: "/builder/[id]/assistant",
			params: { id: document.sourceResumeId, ask: t`Redraft this letter from the posting`, send: "1" },
		});
	};
	const status = {
		text: store.locked
			? t`Locked`
			: store.status === "saving"
				? t`Saving…`
				: store.status === "offline"
					? t`Offline · Changes kept on this device`
					: t`Saved · to the hiring team at ${document?.recipientCompany ?? ""}`,
		// Close the paragraph being edited in the same render: a focused input handed the undone text echoes it back as a
		// new edit, which cleared Redo.
		onUndo: () => {
			setEditing(undefined);
			store.undo();
		},
		onRedo: () => {
			setEditing(undefined);
			store.redo();
		},
		canUndo: ready && store.canUndo,
		canRedo: ready && store.canRedo,
	};
	return (
		<>
			<LetterDocument id={id} />
			<PushScreen
				title={STORYBOARD ? t`Lumen cover letter` : (document?.name ?? t`Cover letter`)}
				overlay={
					picker ? (
						<BottomSheet
							title={picker === "resume" ? t`Resume` : t`Application`}
							height={480}
							onClose={() => setPicker(null)}
						>
							{picker === "resume"
								? (resumes.data ?? [])
										.filter((row) => row.type === "resume" && !row.trashedAt)
										.map((row, index, all) => (
											<ListRow
												key={row.id}
												title={row.name}
												top={index === 0}
												last={index === all.length - 1}
												accessibilityRole="radio"
												accessibilityState={{ selected: row.id === document?.sourceResumeId }}
												trailing={
													row.id === document?.sourceResumeId ? (
														<Icon name="check" size={24} color="accentText" />
													) : undefined
												}
												onPress={() => pick("sourceResumeId", row.id)}
											/>
										))
								: (applications.data ?? []).map((row, index, all) => (
										<ListRow
											key={row.id}
											title={`${row.company} · ${row.role}`}
											top={index === 0}
											last={index === all.length - 1}
											accessibilityRole="radio"
											accessibilityState={{ selected: row.id === document?.sourceApplicationId }}
											trailing={
												row.id === document?.sourceApplicationId ? (
													<Icon name="check" size={24} color="accentText" />
												) : undefined
											}
											onPress={() => pick("sourceApplicationId", row.id)}
										/>
									))}
						</BottomSheet>
					) : null
				}
				status={status}
				docked
				barEnd={
					<>
						<IconButton
							icon="sparkle"
							label={t`Assistant`}
							disabled={!document?.sourceResumeId}
							onPress={() => document?.sourceResumeId && router.push(`/builder/${document.sourceResumeId}/assistant`)}
						/>
						{/* The document menu (B19), for this letter. */}
						<IconButton
							icon="dots-three"
							label={t`More`}
							onPress={() => router.push(`/builder/${id}/menu?type=letter`)}
						/>
					</>
				}
			>
				<DocumentState
					loading={query.isPending}
					error={query.isError}
					retry={() => void query.refetch()}
					height={292}
				/>
				{document && (
					<>
						<View style={{ paddingTop: 28, paddingHorizontal: 24, gap: 16 }}>
							<Text variant="prose">{document.greeting ?? ""}</Text>
							{splitBlocks(document.content).map((block, index) => (
								<View key={index}>
									{editing === index ? (
										<TextInput
											accessibilityLabel={t`Letter paragraph ${index + 1}`}
											value={typed}
											autoFocus
											multiline
											// A paragraph is one block: Return finishes it and puts the keyboard away.
											submitBehavior="blurAndSubmit"
											returnKeyType="done"
											// It grows with its text; a drag scrolls the letter (and puts the keyboard away), not the paragraph.
											scrollEnabled={false}
											caretHidden={STORYBOARD}
											onFocus={letterFieldFocus.onFocus}
											onBlur={() => {
												letterFieldFocus.onBlur();
												setEditing(undefined);
											}}
											onChangeText={(value) => {
												setTyped(value);
												store.update(
													(d) => {
														const current = splitBlocks(d.content)[index];
														if (current)
															d.content = d.content.replace(current.html, () => replaceBlockText(current.html, value));
													},
													{ coalesceKey: `letter-${id}-${index}-${visit.current}`, sameStep: true },
												);
											}}
											style={[typeScale.prose, { padding: 0, color: colors.ink, includeFontPadding: false }]}
										/>
									) : (
										<Touch
											feedback="none"
											accessibilityLabel={block.text}
											onPress={
												ready && store.locked
													? letterLockedNotice
													: ready && /^<p>[^<]*<\/p>$/.test(block.html)
														? () => {
																visit.current++;
																setTyped(block.text);
																setEditing(index);
															}
														: undefined
											}
										>
											<Text variant="prose">{block.text}</Text>
										</Touch>
									)}
								</View>
							))}
						</View>
						{store.status === "error" && (
							<View style={{ margin: 24 }}>
								<Text
									color="dangerText"
									accessibilityRole="alert"
								>{t`Couldn't save. Your text is kept on this device.`}</Text>
								<ListRow title={t`Try again`} onPress={store.retry} />
							</View>
						)}
						<SectionHeading title={t`Details`} />
						<ListRow
							title={t`Resume`}
							secondary={resume.data?.name}
							trailing="caret"
							onPress={() => setPicker("resume")}
						/>
						<ListRow
							title={t`Application`}
							secondary={application.data ? `${application.data.company} · ${application.data.role}` : undefined}
							trailing="caret"
							// A letter recorded as sent keeps its application link.
							onPress={sent ? undefined : () => setPicker("application")}
						/>
						{document.sourceApplicationId && document.sourceResumeId && !capturing ? (
							<View style={{ paddingHorizontal: 24, height: 44, justifyContent: "center" }}>
								<TextLink label={t`Draft from the posting`} icon="sparkle" onPress={draftFromPosting} />
							</View>
						) : null}
						{sentLine ? (
							<Text color="ink3" style={{ marginHorizontal: 24, marginTop: 4 }}>
								{t`This letter is recorded as sent.`}
							</Text>
						) : null}
						<ListRow title={t`Recipient`} secondary={document.recipient ?? undefined} trailing="caret" last boxHidden />
					</>
				)}
			</PushScreen>
		</>
	);
}
